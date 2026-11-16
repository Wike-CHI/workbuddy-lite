#include "chrome_cookies.h"

#include <windows.h>
#include <bcrypt.h>
#include <dpapi.h>

#include <cstdlib>
#include <fstream>
#include <sstream>
#include <vector>

#include "common.h"

namespace wbl {
namespace {

constexpr int kSqliteOk = 0;
constexpr int kSqliteRow = 100;
constexpr int kSqliteDone = 101;

struct SqliteApi {
  void* dll = nullptr;
  int (*open_v2)(const char*, void**, int, const char*) = nullptr;
  int (*prepare_v2)(void*, const char*, int, void**, const char**) = nullptr;
  int (*step)(void*) = nullptr;
  const unsigned char* (*column_text)(void*, int) = nullptr;
  int (*column_bytes)(void*, int) = nullptr;
  long long (*column_int64)(void*, int) = nullptr;
  int (*finalize)(void*) = nullptr;
  int (*close)(void*) = nullptr;

  bool load() {
    if (dll) return true;
    dll = reinterpret_cast<void*>(LoadLibraryW(L"winsqlite3.dll"));
    if (!dll) return false;
    auto get = [&](const char* name) {
      return reinterpret_cast<void*>(GetProcAddress(reinterpret_cast<HMODULE>(dll), name));
    };
    open_v2 = reinterpret_cast<decltype(open_v2)>(get("sqlite3_open_v2"));
    prepare_v2 = reinterpret_cast<decltype(prepare_v2)>(get("sqlite3_prepare_v2"));
    step = reinterpret_cast<decltype(step)>(get("sqlite3_step"));
    column_text = reinterpret_cast<decltype(column_text)>(get("sqlite3_column_text"));
    column_bytes = reinterpret_cast<decltype(column_bytes)>(get("sqlite3_column_bytes"));
    column_int64 = reinterpret_cast<decltype(column_int64)>(get("sqlite3_column_int64"));
    finalize = reinterpret_cast<decltype(finalize)>(get("sqlite3_finalize"));
    close = reinterpret_cast<decltype(close)>(get("sqlite3_close"));
    return open_v2 && prepare_v2 && step && column_text && column_bytes && column_int64 && finalize && close;
  }
};

std::string base64Decode(const std::string& input) {
  static const std::string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  int table[256];
  for (auto& v : table) v = -1;
  for (size_t i = 0; i < chars.size(); ++i) table[static_cast<unsigned char>(chars[i])] = static_cast<int>(i);

  std::string out;
  int value = 0;
  int bits = -8;
  for (unsigned char c : input) {
    if (c == '=' || table[c] == -1) continue;
    value = (value << 6) + table[c];
    bits += 6;
    if (bits >= 0) {
      out.push_back(static_cast<char>((value >> bits) & 0xFF));
      bits -= 8;
    }
  }
  return out;
}

std::wstring chromeUserData() {
  wchar_t* local = nullptr;
  size_t len = 0;
  if (_wdupenv_s(&local, &len, L"LOCALAPPDATA") != 0 || !local) return L"";
  std::wstring path = std::wstring(local) + L"\\Google\\Chrome\\User Data";
  free(local);
  return path;
}

bool readAllBytes(const std::wstring& path, std::string& out) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                            nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  LARGE_INTEGER size{};
  if (!GetFileSizeEx(file, &size) || size.QuadPart <= 0 || size.QuadPart > 64 * 1024 * 1024) {
    CloseHandle(file);
    return false;
  }
  out.resize(static_cast<size_t>(size.QuadPart));
  DWORD read = 0;
  BOOL ok = ReadFile(file, out.data(), static_cast<DWORD>(out.size()), &read, nullptr);
  CloseHandle(file);
  if (!ok) return false;
  out.resize(read);
  return true;
}

// 从 Local State 拿 DPAPI 保护的 AES key
bool chromeMasterKey(std::vector<BYTE>& key, std::string& err) {
  std::wstring root = chromeUserData();
  if (root.empty()) {
    err = "找不到 LOCALAPPDATA";
    return false;
  }
  std::string raw;
  if (!readAllBytes(root + L"\\Local State", raw)) {
    err = "读取 Chrome Local State 失败（Chrome 没装？）";
    return false;
  }
  json doc = json::parse(raw, nullptr, false);
  if (doc.is_discarded() || !doc.is_object()) {
    err = "Chrome Local State 解析失败";
    return false;
  }
  std::string encoded = jstr(jval(doc, "os_crypt", json::object()), "encrypted_key");
  if (encoded.empty()) {
    err = "Chrome 没有保存加密密钥";
    return false;
  }
  std::string blob = base64Decode(encoded);
  if (blob.size() < 5 || blob.compare(0, 5, "DPAPI") != 0) {
    err = "不认识的 Chrome 密钥格式";
    return false;
  }
  blob = blob.substr(5);

  DATA_BLOB in{};
  in.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(blob.data()));
  in.cbData = static_cast<DWORD>(blob.size());
  DATA_BLOB out{};
  if (!CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr, 0, &out)) {
    err = "DPAPI 解密 Chrome 密钥失败";
    return false;
  }
  key.assign(out.pbData, out.pbData + out.cbData);
  LocalFree(out.pbData);
  return key.size() == 32;
}

// Chrome v10：AES-256-GCM，nonce 12 字节，tag 16 字节，无 AAD
bool decryptV10(const std::vector<BYTE>& key, const std::string& blob, std::string& out) {
  if (blob.size() < 3 + 12 + 16) return false;
  if (!(blob[0] == 'v' && blob[1] == '1' && blob[2] == '0')) return false;
  const BYTE* nonce = reinterpret_cast<const BYTE*>(blob.data()) + 3;
  const BYTE* cipher = reinterpret_cast<const BYTE*>(blob.data()) + 15;
  ULONG cipherLen = static_cast<ULONG>(blob.size() - 15);
  if (cipherLen < 16) return false;
  const ULONG dataLen = cipherLen - 16;
  const BYTE* tag = cipher + dataLen;

  BCRYPT_ALG_HANDLE alg = nullptr;
  BCRYPT_KEY_HANDLE hkey = nullptr;
  bool ok = false;
  if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_AES_ALGORITHM, nullptr, 0) != 0) return false;
  if (BCryptSetProperty(alg, BCRYPT_CHAINING_MODE, reinterpret_cast<PUCHAR>(const_cast<wchar_t*>(BCRYPT_CHAIN_MODE_GCM)),
                        sizeof(BCRYPT_CHAIN_MODE_GCM), 0) == 0) {
    if (BCryptGenerateSymmetricKey(alg, &hkey, nullptr, 0, const_cast<PUCHAR>(key.data()),
                                   static_cast<ULONG>(key.size()), 0) == 0) {
      BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
      BCRYPT_INIT_AUTH_MODE_INFO(info);
      info.pbNonce = const_cast<PUCHAR>(nonce);
      info.cbNonce = 12;
      info.pbTag = const_cast<PUCHAR>(tag);
      info.cbTag = 16;

      std::vector<BYTE> plain(dataLen + 16);
      ULONG written = 0;
      if (BCryptDecrypt(hkey, const_cast<PUCHAR>(cipher), dataLen, &info, nullptr, 0, plain.data(),
                        static_cast<ULONG>(plain.size()), &written, 0) == 0) {
        out.assign(reinterpret_cast<char*>(plain.data()), written);
        ok = true;
      }
      BCryptDestroyKey(hkey);
    }
  }
  BCryptCloseAlgorithmProvider(alg, 0);
  return ok;
}

}  // namespace

ChromeImportResult loadChromeCookies() {
  ChromeImportResult result;
  std::wstring root = chromeUserData();
  if (root.empty()) {
    result.error = "找不到 Chrome 目录";
    return result;
  }

  std::wstring dbPath = root + L"\\Default\\Network\\Cookies";
  std::string db;
  if (!readAllBytes(dbPath, db)) {
    result.error = "读取 Chrome Cookies 失败：Chrome 正在运行时会独占这个文件，请先完全退出 Chrome 再试";
    return result;
  }

  std::vector<BYTE> key;
  std::string keyErr;
  if (!chromeMasterKey(key, keyErr)) {
    result.error = keyErr;
    return result;
  }

  // 写到临时文件再用 winsqlite3 打开
  wchar_t tempDir[MAX_PATH] = {0};
  GetTempPathW(MAX_PATH, tempDir);
  wchar_t tempFile[MAX_PATH] = {0};
  GetTempFileNameW(tempDir, L"wbc", 0, tempFile);
  {
    HANDLE out = CreateFileW(tempFile, GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, nullptr);
    if (out == INVALID_HANDLE_VALUE) {
      result.error = "无法写临时文件";
      return result;
    }
    DWORD written = 0;
    WriteFile(out, db.data(), static_cast<DWORD>(db.size()), &written, nullptr);
    CloseHandle(out);
  }

  SqliteApi sqlite;
  if (!sqlite.load()) {
    DeleteFileW(tempFile);
    result.error = "系统缺少 winsqlite3.dll";
    return result;
  }

  void* handle = nullptr;
  std::string utf8Path;
  {
    int len = WideCharToMultiByte(CP_UTF8, 0, tempFile, -1, nullptr, 0, nullptr, nullptr);
    utf8Path.resize(len);
    WideCharToMultiByte(CP_UTF8, 0, tempFile, -1, utf8Path.data(), len, nullptr, nullptr);
    if (!utf8Path.empty() && utf8Path.back() == '\0') utf8Path.pop_back();
  }
  if (sqlite.open_v2(utf8Path.c_str(), &handle, 1 /*READONLY*/, nullptr) != kSqliteOk) {
    DeleteFileW(tempFile);
    result.error = "打开 Cookies 数据库失败";
    return result;
  }

  void* stmt = nullptr;
  const char* sql =
      "SELECT host_key,name,path,encrypted_value,expires_utc,is_secure,is_httponly,samesite FROM cookies";
  if (sqlite.prepare_v2(handle, sql, -1, &stmt, nullptr) != kSqliteOk) {
    sqlite.close(handle);
    DeleteFileW(tempFile);
    result.error = "查询 Cookies 失败";
    return result;
  }

  const int64_t unixEpochOffset = 11644473600LL;  // 1601 -> 1970 秒
  while (sqlite.step(stmt) == kSqliteRow) {
    result.total++;
    const unsigned char* host = sqlite.column_text(stmt, 0);
    const unsigned char* name = sqlite.column_text(stmt, 1);
    const unsigned char* path = sqlite.column_text(stmt, 2);
    const unsigned char* blob = sqlite.column_text(stmt, 3);
    if (!host || !name || !blob) continue;

    int len = sqlite.column_bytes(stmt, 3);
    if (len <= 0) continue;

    std::string encrypted(reinterpret_cast<const char*>(blob), static_cast<size_t>(len));
    ChromeCookie cookie;
    cookie.domain = reinterpret_cast<const char*>(host);
    cookie.name = reinterpret_cast<const char*>(name);
    cookie.path = path ? reinterpret_cast<const char*>(path) : "/";
    cookie.secure = sqlite.column_int64(stmt, 5) != 0;
    cookie.httpOnly = sqlite.column_int64(stmt, 6) != 0;
    int sameSite = static_cast<int>(sqlite.column_int64(stmt, 7));
    cookie.sameSite = (sameSite >= 0 && sameSite <= 2) ? sameSite : -1;

    int64_t expiresUtc = sqlite.column_int64(stmt, 4);
    if (expiresUtc > 0) {
      int64_t seconds = expiresUtc / 1000000 - unixEpochOffset;
      if (seconds > 0) cookie.expiresUnix = seconds;
    }

    std::string plain;
    if (decryptV10(key, encrypted, plain)) {
      cookie.value = plain;
      result.decrypted++;
      if (!cookie.name.empty() && !cookie.domain.empty()) result.cookies.push_back(cookie);
    } else {
      result.skipped++;  // v20 / app-bound 或空值
    }
  }

  sqlite.finalize(stmt);
  sqlite.close(handle);
  DeleteFileW(tempFile);
  result.ok = true;
  return result;
}

}  // namespace wbl
