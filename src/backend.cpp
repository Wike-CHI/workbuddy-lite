#include "backend.h"

#include <shellapi.h>
#include <shobjidl.h>

#include <algorithm>
#include <cctype>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <vector>

#include "catalog.h"
#include "normalize.h"

namespace wbl {
namespace {

std::string localAppDir() {
  // 自动化验证时用独立目录，避免污染真实会话；多开也方便隔离
  const char* override = getenv("WORKBUDDY_LITE_DATA");
  if (override && *override) {
    CreateDirectoryA(override, nullptr);
    return override;
  }
  const char* base = getenv("LOCALAPPDATA");
  std::string dir = base ? base : ".";
  dir += "\\WorkBuddyLite";
  CreateDirectoryA(dir.c_str(), nullptr);
  return dir;
}

std::string exeDir() {
  char buf[MAX_PATH] = {0};
  GetModuleFileNameA(nullptr, buf, MAX_PATH);
  std::string p(buf);
  size_t pos = p.find_last_of("\\/");
  return pos == std::string::npos ? "." : p.substr(0, pos);
}

std::string contentTypeFor(const std::string& path) {
  std::string lower = path;
  for (auto& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  auto ends = [&](const char* ext) {
    size_t n = strlen(ext);
    return lower.size() >= n && lower.compare(lower.size() - n, n, ext) == 0;
  };
  if (ends(".html") || ends(".htm")) return "text/html; charset=utf-8";
  if (ends(".js") || ends(".mjs")) return "text/javascript; charset=utf-8";
  if (ends(".css")) return "text/css; charset=utf-8";
  if (ends(".svg")) return "image/svg+xml";
  if (ends(".json")) return "application/json; charset=utf-8";
  if (ends(".png")) return "image/png";
  if (ends(".jpg") || ends(".jpeg")) return "image/jpeg";
  if (ends(".webp")) return "image/webp";
  if (ends(".gif")) return "image/gif";
  if (ends(".bmp")) return "image/bmp";
  if (ends(".avif")) return "image/avif";
  if (ends(".md") || ends(".txt") || ends(".log")) return "text/plain; charset=utf-8";
  if (ends(".csv")) return "text/csv; charset=utf-8";
  if (ends(".pdf")) return "application/pdf";
  // Office Open XML
  if (ends(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ends(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ends(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  // 旧版 Office
  if (ends(".doc")) return "application/msword";
  if (ends(".xls")) return "application/vnd.ms-excel";
  if (ends(".ppt")) return "application/vnd.ms-powerpoint";
  // 视频
  if (ends(".mp4") || ends(".m4v")) return "video/mp4";
  if (ends(".webm")) return "video/webm";
  if (ends(".mov")) return "video/quicktime";
  if (ends(".ogv")) return "video/ogg";
  // 音频
  if (ends(".mp3")) return "audio/mpeg";
  if (ends(".wav")) return "audio/wav";
  if (ends(".m4a")) return "audio/mp4";
  if (ends(".ogg") || ends(".oga")) return "audio/ogg";
  if (ends(".zip")) return "application/zip";
  return "application/octet-stream";
}

// 只接受浏览器 <img> 能直接显示的格式；扩展名跟 mime 走，避免把 jpeg 存成 .png
const char* imageExtFor(const std::string& mime) {
  if (mime == "image/jpeg" || mime == "image/jpg") return ".jpg";
  if (mime == "image/webp") return ".webp";
  if (mime == "image/gif") return ".gif";
  return ".png";
}

std::string truncateTitle(const std::string& text) {
  // 去掉换行、压缩空白
  std::string out;
  bool space = false;
  for (unsigned char c : text) {
    if (c == '\n' || c == '\r' || c == '\t' || c == ' ') {
      space = true;
      continue;
    }
    if (space && !out.empty()) out.push_back(' ');
    space = false;
    out.push_back(static_cast<char>(c));
  }
  // 按码点计数：一个汉字占 3 字节，按字节截会把「12 个字的标题」截成 9 个字
  constexpr size_t kMaxCp = 24;
  size_t i = 0, cp = 0;
  while (i < out.size() && cp < kMaxCp) {
    unsigned char c = static_cast<unsigned char>(out[i]);
    size_t len = 1;
    if ((c & 0xE0) == 0xC0) len = 2;
    else if ((c & 0xF0) == 0xE0) len = 3;
    else if ((c & 0xF8) == 0xF0) len = 4;
    if (i + len > out.size()) len = out.size() - i;
    i += len;
    ++cp;
  }
  if (i < out.size()) {
    while (i > 0 && out[i - 1] == ' ') --i;  // 截断后别把空格留在省略号前
    return out.substr(0, i) + "…";
  }
  return out.empty() ? "新会话" : out;
}

bool isAuthError(const std::string& msg) {
  return msg.find("Authentication required") != std::string::npos ||
         msg.find("登录") != std::string::npos;
}

std::string todayKey() {
  std::time_t t = std::time(nullptr);
  std::tm tmv{};
  localtime_s(&tmv, &t);
  char buf[16];
  std::strftime(buf, sizeof(buf), "%Y-%m-%d", &tmv);
  return buf;
}

double numAt(const json& o, const char* key, double def = 0.0) {
  if (!o.is_object()) return def;
  auto it = o.find(key);
  if (it == o.end() || !it->is_number()) return def;
  return it->get<double>();
}

std::string leafName(const std::string& path) {
  size_t end = path.find_last_not_of("\\/");
  if (end == std::string::npos) return path;
  size_t pos = path.find_last_of("\\/", end);
  return pos == std::string::npos ? path.substr(0, end + 1) : path.substr(pos + 1, end - pos);
}

bool isDirectoryPath(const std::string& path) {
  if (path.empty()) return false;
  DWORD attr = GetFileAttributesW(utf8ToWide(path).c_str());
  return attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

bool isFilePath(const std::string& path) {
  if (path.empty()) return false;
  DWORD attr = GetFileAttributesW(utf8ToWide(path).c_str());
  return attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

std::string canonicalPath(const std::string& path) {
  std::error_code ec;
  auto p = std::filesystem::weakly_canonical(std::filesystem::path(utf8ToWide(path)), ec);
  if (ec) return "";
  return wideToUtf8(p.wstring());
}

std::string pathKey(const std::string& path);

// 会话里的子智能体统计（定义在后面）
json subagentStatsOf(const json& session);
json workflowStatsOf(const json& session);

// 只允许读当前工作空间里的文件，挡住 ../ 和绝对路径逃逸
bool isPathInside(const std::string& root, const std::string& target) {
  std::string r = pathKey(canonicalPath(root));
  std::string t = pathKey(canonicalPath(target));
  if (r.empty() || t.empty()) return false;
  return t == r || t.rfind(r + "\\", 0) == 0;
}

std::string pathKey(const std::string& path) {
  std::string s = path;
  for (auto& c : s) {
    if (c == '/') c = '\\';
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  while (s.size() > 1 && s.back() == '\\') s.pop_back();
  return s;
}

bool samePath(const std::string& a, const std::string& b) {
  return !a.empty() && !b.empty() && pathKey(a) == pathKey(b);
}

double parseCreditMultiplier(const std::string& credits) {
  size_t pos = credits.find_first_of("xX×");
  try {
    if (pos != std::string::npos) return std::stod(credits.substr(pos + 1));
    return std::stod(credits);
  } catch (...) {
    return 0.0;
  }
}

json modelEntry(const json& m) {
  json meta = jval(m, "_meta", json::object());
  std::string credits = jstr(meta, "credits", jstr(m, "description"));
  auto flag = [&](const char* key) {
    json v = jval(meta, key, json(false));
    return v.is_boolean() && v.get<bool>();
  };
  return {{"id", jstr(m, "modelId")},
          {"name", jstr(m, "name", jstr(m, "modelId"))},
          {"credits", credits},
          {"multiplier", parseCreditMultiplier(credits)},
          {"maxInputTokens", static_cast<int64_t>(numAt(meta, "maxInputTokens", 0))},
          {"supportsImages", flag("supportsImages")},
          {"supportsReasoning", flag("supportsReasoning")},
          {"effortOptions", jval(meta, "effortOptions", json::array())}};
}

json demoModels() {
  return json::array(
      {{{"id", "deepseek-v4.1-flash"},
        {"name", "DeepSeek-V4.1-Flash"},
        {"credits", "x0.11 credits"},
        {"multiplier", 0.11},
        {"maxInputTokens", 1000000},
        {"supportsImages", true},
        {"supportsReasoning", true},
        {"effortOptions", json::array()}},
       {{"id", "hy4free"},
        {"name", "Hy4"},
        {"credits", "x0.00 credits"},
        {"multiplier", 0.0},
        {"maxInputTokens", 960000},
        {"supportsImages", true},
        {"supportsReasoning", true},
        {"effortOptions", json::array()}},
       {{"id", "hy4std"},
        {"name", "Hy4"},
        {"credits", "x0.29 credits"},
        {"multiplier", 0.29},
        {"maxInputTokens", 960000},
        {"supportsImages", true},
        {"supportsReasoning", true},
        {"effortOptions", json::array()}},
       {{"id", "glm-5.3"},
        {"name", "GLM-5.3"},
        {"credits", "x0.50 credits"},
        {"multiplier", 0.5},
        {"maxInputTokens", 200000},
        {"supportsImages", false},
        {"supportsReasoning", true},
        {"effortOptions", json::array()}}});
}

// 演示模式的会话配置：结构与真实 ACP 一致，方便没登录态时验证控件
json demoConfigOptions() {
  json thoughts = json::array({{{"value", "low"}, {"name", "Low"}},
                               {{"value", "high"}, {"name", "High"}},
                               {{"value", "max"}, {"name", "Max"}},
                               {{"value", "enabled"}, {"name", "On (default)"}}});
  json sandbox = json::array({{{"value", "true"}, {"name", "Sandbox Environment"}},
                              {{"value", "false"}, {"name", "Local Environment"}}});
  return json::array(
      {{{"type", "select"},
        {"id", "thought_level"},
        {"name", "Deep Thinking"},
        {"description", "Choose reasoning effort level for this session"},
        {"currentValue", "high"},
        {"options", thoughts}},
       {{"type", "select"},
        {"id", "sandbox"},
        {"name", "Sandbox"},
        {"description", "Run shell commands inside the sandbox isolation layer"},
        {"currentValue", "false"},
        {"options", sandbox}},
       {{"type", "boolean"},
        {"id", "multitask"},
        {"name", "Multitask"},
        {"description", "Coordinate detached workers"},
        {"category", "_codebuddy.ai/multitask"},
        {"currentValue", false}}});
}

json loadStoreFile(const std::string& path) {
  std::ifstream in(path);
  if (!in) return json::object();
  std::stringstream ss;
  ss << in.rdbuf();
  json doc = json::parse(ss.str(), nullptr, false);
  if (doc.is_discarded() || !doc.is_object() || !doc.contains("sessions")) return json::object();
  return doc;
}

json readJsonFile(const std::string& path) {
  std::ifstream in(path);
  if (!in) return json::object();
  std::stringstream ss;
  ss << in.rdbuf();
  json doc = json::parse(ss.str(), nullptr, false);
  return (doc.is_discarded() || !doc.is_object()) ? json::object() : doc;
}

json extractJsonObject(const std::string& text) {
  size_t start = text.find('{');
  size_t end = text.rfind('}');
  if (start == std::string::npos || end == std::string::npos || end <= start) return json::object();
  json doc = json::parse(text.substr(start, end - start + 1), nullptr, false);
  return (doc.is_discarded() || !doc.is_object()) ? json::object() : doc;
}

std::string projectsFilePath() { return localAppDir() + "\\projects.json"; }

void saveProjectsDoc(const json& doc) {
  std::string path = projectsFilePath();
  std::string tmp = path + ".tmp";
  HANDLE mtx = CreateMutexA(nullptr, FALSE, "Local\\WorkBuddyLiteProjects");
  if (mtx) WaitForSingleObject(mtx, 5000);
  std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
  if (out) {
    out << dumpJson(doc);
    out.close();
    MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);
  }
  if (mtx) {
    ReleaseMutex(mtx);
    CloseHandle(mtx);
  }
}

// ---------- 轻量设置（记住上次用的工作空间） ----------
std::string settingsPath() { return localAppDir() + "\\settings.json"; }

void saveSetting(const std::string& key, const std::string& value) {
  std::string path = settingsPath();
  std::string tmp = path + ".tmp";
  HANDLE mtx = CreateMutexA(nullptr, FALSE, "Local\\WorkBuddyLiteSettings");
  if (mtx) WaitForSingleObject(mtx, 5000);
  json doc = readJsonFile(path);
  doc[key] = value;
  std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
  if (out) {
    out << dumpJson(doc);
    out.close();
    MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);
  }
  if (mtx) {
    ReleaseMutex(mtx);
    CloseHandle(mtx);
  }
}

// ---------- 工作空间：一个名字 + 最多 5 个文件夹 ----------
constexpr size_t kMaxWorkspaceFolders = 5;

std::string trimStr(const std::string& s) {
  size_t b = s.find_first_not_of(" \t\r\n");
  if (b == std::string::npos) return "";
  size_t e = s.find_last_not_of(" \t\r\n");
  return s.substr(b, e - b + 1);
}

std::string workspacesPath() { return localAppDir() + "\\workspaces.json"; }

json loadWorkspacesDoc() {
  json doc = readJsonFile(workspacesPath());
  json arr = jval(doc, "workspaces", json::array());
  if (!arr.is_array()) arr = json::array();
  return json{{"workspaces", arr}};
}

bool saveWorkspacesDoc(const json& doc) {
  std::string path = workspacesPath();
  std::string tmp = path + ".tmp";
  HANDLE mtx = CreateMutexA(nullptr, FALSE, "Local\\WorkBuddyLiteWorkspaces");
  if (mtx) WaitForSingleObject(mtx, 5000);
  bool ok = false;
  std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
  if (out) {
    out << dumpJson(doc);
    out.close();
    ok = MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING) != 0;
  }
  if (mtx) {
    ReleaseMutex(mtx);
    CloseHandle(mtx);
  }
  return ok;
}

std::vector<std::string> foldersOf(const json& ws) {
  std::vector<std::string> out;
  if (!ws.is_object()) return out;
  json arr = jval(ws, "folders", json::array());
  if (!arr.is_array()) return out;
  for (const auto& f : arr) {
    if (f.is_string() && !f.get<std::string>().empty()) out.push_back(f.get<std::string>());
  }
  return out;
}

// ---------- 外部命令（git） ----------
std::string joinPathSafe(const std::string& a, const std::string& b);

struct CmdResult {
  bool ok = false;
  bool timedOut = false;
  int code = -1;
  std::string out;
};

std::wstring quoteArg(const std::wstring& a) {
  if (a.find_first_of(L" \t\"") == std::wstring::npos) return a;
  std::wstring out = L"\"";
  int backslashes = 0;
  for (wchar_t c : a) {
    if (c == L'\\') {
      ++backslashes;
      continue;
    }
    if (c == L'"') {
      out.append(static_cast<size_t>(backslashes) * 2 + 1, L'\\');
      out.push_back(L'"');
      backslashes = 0;
      continue;
    }
    if (backslashes) {
      out.append(static_cast<size_t>(backslashes), L'\\');
      backslashes = 0;
    }
    out.push_back(c);
  }
  if (backslashes) out.append(static_cast<size_t>(backslashes) * 2, L'\\');
  out.push_back(L'"');
  return out;
}

// 跑一个短命命令并回收输出（git status/diff 之类），超时就杀进程
CmdResult runCapture(const std::vector<std::string>& args, const std::string& cwd, int timeoutMs = 20000) {
  CmdResult r;
  if (args.empty()) return r;
  std::wstring cmd;
  for (const auto& a : args) {
    if (!cmd.empty()) cmd += L' ';
    cmd += quoteArg(utf8ToWide(a));
  }

  SECURITY_ATTRIBUTES sa{};
  sa.nLength = sizeof(sa);
  sa.bInheritHandle = TRUE;
  HANDLE rd = nullptr;
  HANDLE wr = nullptr;
  if (!CreatePipe(&rd, &wr, &sa, 0)) return r;
  SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);

  STARTUPINFOW si{};
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
  si.wShowWindow = SW_HIDE;
  si.hStdOutput = wr;
  si.hStdError = wr;

  PROCESS_INFORMATION pi{};
  std::vector<wchar_t> buf(cmd.begin(), cmd.end());
  buf.push_back(L'\0');
  std::wstring wcwd = utf8ToWide(cwd);
  BOOL started = CreateProcessW(nullptr, buf.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr,
                                wcwd.empty() ? nullptr : wcwd.c_str(), &si, &pi);
  CloseHandle(wr);
  if (!started) {
    CloseHandle(rd);
    return r;
  }

  const DWORD start = GetTickCount();
  char chunk[4096];
  for (;;) {
    DWORD avail = 0;
    if (PeekNamedPipe(rd, nullptr, 0, nullptr, &avail, nullptr) && avail > 0) {
      DWORD n = 0;
      if (!ReadFile(rd, chunk, sizeof(chunk), &n, nullptr) || n == 0) break;
      if (r.out.size() < 2u * 1024 * 1024) r.out.append(chunk, n);
      continue;
    }
    DWORD w = WaitForSingleObject(pi.hProcess, 30);
    if (w == WAIT_OBJECT_0) {
      DWORD n = 0;
      while (ReadFile(rd, chunk, sizeof(chunk), &n, nullptr) && n > 0) {
        if (r.out.size() < 2u * 1024 * 1024) r.out.append(chunk, n);
      }
      break;
    }
    if (GetTickCount() - start > static_cast<DWORD>(timeoutMs)) {
      TerminateProcess(pi.hProcess, 1);
      CloseHandle(rd);
      CloseHandle(pi.hProcess);
      CloseHandle(pi.hThread);
      r.timedOut = true;
      return r;
    }
  }
  DWORD code = 1;
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(rd);
  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);
  r.code = static_cast<int>(code);
  r.ok = code == 0;
  return r;
}

// codebuddy 在 Windows 上是 npm 的 .cmd shim，CreateProcess 不能直接启动，必须经 cmd /c
CmdResult runCli(const std::vector<std::string>& args, const std::string& cwd, int timeoutMs) {
  std::vector<std::string> full{"cmd.exe", "/d", "/c", "codebuddy"};
  full.insert(full.end(), args.begin(), args.end());
  return runCapture(full, cwd, timeoutMs);
}

std::string tailText(const std::string& s, size_t maxBytes) {
  std::string t = trimStr(s);
  if (t.size() <= maxBytes) return t;
  return "…" + t.substr(t.size() - maxBytes);
}

// 只允许命令行参数里安全的字符，避免经 cmd.exe 时被 & | 之类的元字符注入
bool safeMarketToken(const std::string& s) {
  if (s.empty() || s.size() > 160) return false;
  for (unsigned char c : s) {
    if (std::isalnum(c) || c == '.' || c == '_' || c == '-' || c == '@' || c == '/' || c == ':' ||
        c == '+' || c == '~')
      continue;
    return false;
  }
  return true;
}

bool looksLikeMarketSource(const std::string& url) {
  std::string low = url;
  for (auto& c : low) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  if (low.rfind("http://", 0) == 0 || low.rfind("https://", 0) == 0 ||
      low.rfind("ssh://", 0) == 0 || low.rfind("git://", 0) == 0 || low.rfind("git@", 0) == 0 ||
      low.rfind("file://", 0) == 0)
    return true;
  // GitHub 的 owner/repo 简写，或本机路径
  if (low.find('/') != std::string::npos || low.find('\\') != std::string::npos) return true;
  return false;
}

std::string marketNameFromUrl(const std::string& raw) {
  std::string url = trimStr(raw);
  size_t cut = url.find_first_of("?#");
  if (cut != std::string::npos) url = url.substr(0, cut);
  while (!url.empty() && (url.back() == '/' || url.back() == '\\')) url.pop_back();
  size_t slash = url.find_last_of("/\\");
  std::string name = slash == std::string::npos ? url : url.substr(slash + 1);
  for (const char* ext : {".git", ".zip"}) {
    size_t n = strlen(ext);
    if (name.size() > n) {
      std::string tail = name.substr(name.size() - n);
      for (auto& c : tail) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
      if (tail == ext) name = name.substr(0, name.size() - n);
    }
  }
  std::string out;
  for (unsigned char c : name) {
    if (std::isalnum(c) || c == '.' || c == '_' || c == '-') out.push_back(static_cast<char>(c));
    else if (!out.empty() && out.back() != '-') out.push_back('-');
  }
  while (!out.empty() && out.back() == '-') out.pop_back();
  if (out.empty()) out = "market";
  return out;
}

bool isGitRepo(const std::string& dir) {
  auto r = runCapture({"git", "-C", dir, "rev-parse", "--is-inside-work-tree"}, dir, 8000);
  return r.ok && r.out.find("true") != std::string::npos;
}

json gitStatusFor(const std::string& dir) {
  json out = {{"path", dir},
              {"label", leafName(dir)},
              {"isRepo", false},
              {"branch", ""},
              {"files", json::array()}};
  if (!isGitRepo(dir)) return out;
  out["isRepo"] = true;

  auto br = runCapture({"git", "-C", dir, "rev-parse", "--abbrev-ref", "HEAD"}, dir, 8000);
  if (br.ok) out["branch"] = trimStr(br.out);

  auto st = runCapture({"git", "-C", dir, "-c", "core.quotePath=false", "status", "--porcelain=v1",
                        "--untracked-files=all"},
                       dir, 15000);
  if (!st.ok) return out;

  json files = json::array();
  std::istringstream iss(st.out);
  std::string line;
  while (std::getline(iss, line)) {
    if (line.size() < 4) continue;
    std::string code = line.substr(0, 2);
    std::string path = line.substr(3);
    size_t arrow = path.find(" -> ");
    if (arrow != std::string::npos) path = path.substr(arrow + 4);
    bool untracked = code == "??";
    bool staged = !untracked && code[0] != ' ';
    std::string status = untracked ? "untracked"
                        : (code[0] == 'D' || code[1] == 'D') ? "deleted"
                        : (code[0] == 'A') ? "added"
                        : (code[0] == 'R') ? "renamed"
                                           : "modified";
    files.push_back({{"path", path},
                     {"abs", joinPathSafe(dir, path)},
                     {"status", status},
                     {"staged", staged},
                     {"untracked", untracked}});
  }
  out["files"] = files;
  return out;
}

json listDirEntries(const std::string& dir) {
  json out = json::array();
  std::error_code ec;
  std::filesystem::path root(utf8ToWide(dir));
  if (!std::filesystem::is_directory(root, ec)) return out;
  for (const auto& entry : std::filesystem::directory_iterator(root, ec)) {
    std::error_code fec;
    std::string name = wideToUtf8(entry.path().filename().wstring());
    if (name.empty()) continue;
    if (name == ".git" || name == "node_modules" || name == ".cache") continue;
    bool isDir = entry.is_directory(fec);
    json item = {{"name", name}, {"path", wideToUtf8(entry.path().wstring())}, {"isDir", isDir}};
    if (!isDir) {
      std::error_code sec;
      auto size = entry.file_size(sec);
      if (!sec) item["size"] = static_cast<int64_t>(size);
    }
    out.push_back(item);
    if (out.size() >= 800) break;
  }
  std::sort(out.begin(), out.end(), [](const json& a, const json& b) {
    bool ad = a.value("isDir", false);
    bool bd = b.value("isDir", false);
    if (ad != bd) return ad;
    std::string an = jstr(a, "name"), bn = jstr(b, "name");
    for (auto& c : an) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    for (auto& c : bn) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return an < bn;
  });
  return out;
}

// ---------- 事件压缩 ----------
// 流式 text/thought 是逐 token 下发的，原样落盘会让一个会话攒到十几万条、
// 整份 sessions.json 几十 MB：启动要解析几秒，打开会话直接把前端卡死。
// 落盘时把相邻同类文本合并成一条；回放语义不变（前端本来就按顺序拼接）。
constexpr size_t kSessionEventCap = 400;
constexpr size_t kEventMergeLimit = 64 * 1024;

bool mergeStreamingEvent(json& target, const std::string& type, const json& data) {
  if (type != "text" && type != "thought") return false;
  if (!target.is_object() || jstr(target, "type") != type) return false;
  json& d = target["data"];
  if (!d.is_object()) return false;
  if (d.contains("images") || d.contains("connectors")) return false;
  std::string add = jstr(data, "text");
  if (add.empty()) return false;
  std::string cur = jstr(d, "text");
  if (cur.size() + add.size() > kEventMergeLimit) return false;  // 太长就分段，别造一个巨型字符串
  d["text"] = cur + add;
  return true;
}

// 压缩单个会话的事件数组，返回压缩前的条数
size_t compactSessionEvents(json& events, size_t cap) {
  if (!events.is_array() || events.empty()) return 0;
  size_t before = events.size();

  json merged = json::array();
  for (const auto& ev : events) {
    std::string type = jstr(ev, "type");
    json data = jval(ev, "data", json::object());
    if (!merged.empty() && mergeStreamingEvent(merged.back(), type, data)) continue;
    merged.push_back({{"type", type}, {"data", data}});
  }

  if (merged.size() > cap) {
    // 保住最早两条（首条用户消息 + 第一轮结果），其余只留最近的
    size_t head = std::min<size_t>(2, merged.size());
    size_t tail = cap > head ? cap - head : 0;
    json kept = json::array();
    for (size_t i = 0; i < head; ++i) kept.push_back(merged[i]);
    for (size_t i = merged.size() - tail; i < merged.size(); ++i) kept.push_back(merged[i]);
    events = kept;
  } else {
    events = merged;
  }
  return before;
}

std::string homePath() {
  const char* p = getenv("USERPROFILE");
  return p ? p : "";
}

std::string joinPathSafe(const std::string& a, const std::string& b) {
  if (a.empty()) return b;
  if (b.empty()) return a;
  char last = a.back();
  return (last == '\\' || last == '/') ? a + b : a + "\\" + b;
}

// CodeBuddy / WorkBuddy 的 projects/<encoded> 目录里，session jsonl 第一条用户消息带 cwd
std::string firstCwdInProject(const std::string& dir) {
  std::error_code ec;
  std::filesystem::path root(utf8ToWide(dir));
  if (!std::filesystem::is_directory(root, ec)) return "";
  std::vector<std::filesystem::path> files;
  for (const auto& entry : std::filesystem::directory_iterator(root, ec)) {
    if (entry.is_regular_file(ec) && entry.path().extension() == L".jsonl") files.push_back(entry.path());
  }
  if (files.empty()) return "";
  std::sort(files.begin(), files.end());

  int scanned = 0;
  for (const auto& file : files) {
    if (scanned++ >= 3) break;
    std::ifstream in(file.wstring().c_str(), std::ios::binary);
    if (!in) continue;
    std::string line;
    int lines = 0;
    while (std::getline(in, line) && lines++ < 40) {
      if (line.find("\"cwd\"") == std::string::npos) continue;
      json obj = json::parse(line, nullptr, false);
      if (obj.is_discarded() || !obj.is_object()) continue;
      std::string cwd = jstr(obj, "cwd");
      if (!cwd.empty()) return cwd;
    }
  }
  return "";
}

json scanProjectRoot(const std::string& root, const std::string& source,
                     const std::map<std::string, std::string>& displayNames) {
  json out = json::array();
  std::error_code ec;
  std::filesystem::path rootPath(utf8ToWide(root));
  if (!std::filesystem::is_directory(rootPath, ec)) return out;

  std::vector<std::filesystem::path> dirs;
  for (const auto& entry : std::filesystem::directory_iterator(rootPath, ec)) {
    if (entry.is_directory(ec)) dirs.push_back(entry.path());
  }
  std::sort(dirs.begin(), dirs.end());

  int count = 0;
  for (const auto& dir : dirs) {
    if (count >= 100) break;
    std::string cwd = firstCwdInProject(wideToUtf8(dir.wstring()));
    if (cwd.empty() || !isDirectoryPath(cwd)) continue;
    std::string label = leafName(cwd);
    auto it = displayNames.find(pathKey(cwd));
    if (it != displayNames.end() && !it->second.empty()) label = it->second;
    out.push_back({{"path", cwd}, {"label", label}, {"source", source}});
    ++count;
  }
  return out;
}

}  // namespace

Backend::Backend(bool demo, std::string cwd, std::string webRoot, bool fresh)
    : demo_(demo), fresh_(fresh), cwd_(std::move(cwd)), webRoot_(std::move(webRoot)) {
  char buf[MAX_PATH] = {0};
  GetModuleFileNameA(nullptr, buf, MAX_PATH);
  exePath_ = buf;

  initStore();
  if (demo_) initDemoMarket();
  if (demo_) initDemoTeam();

  // 没显式传 --cwd 时沿用上次的工作空间；带了 --cwd 时优先把它归到所属工作空间
  if (!cwd_.empty() && !isDirectoryPath(cwd_)) cwd_.clear();
  resolveInitialWorkspace();

  // 模型选择跨进程保留：重启后 bootstrap 就能给出上次用的模型
  {
    json settings = readJsonFile(settingsPath());
    std::string lastModel = jstr(settings, "lastModel");
    if (!lastModel.empty()) {
      std::lock_guard<std::mutex> lk(modelMu_);
      selectedModel_ = lastModel;
    }
  }
}

Backend::~Backend() { stop(); }

std::string Backend::currentCwd() const {
  std::lock_guard<std::mutex> lk(cwdMu_);
  return cwd_;
}

std::string Backend::workspaceName() const {
  json ws = activeWorkspaceInfo();
  return jstr(ws, "name", leafName(currentCwd()));
}

json Backend::findWorkspace(const std::string& id) {
  if (id.empty()) return json::object();
  json doc = loadWorkspacesDoc();
  for (const auto& w : jval(doc, "workspaces", json::array())) {
    if (jstr(w, "id") == id) return w;
  }
  return json::object();
}

json Backend::workspaceByFolder(const std::string& path) {
  if (path.empty()) return json::object();
  std::string key = pathKey(path);
  json doc = loadWorkspacesDoc();
  for (const auto& w : jval(doc, "workspaces", json::array())) {
    for (const auto& f : foldersOf(w)) {
      if (pathKey(f) == key) return w;
    }
  }
  return json::object();
}

json Backend::activeWorkspaceInfo() const {
  {
    std::lock_guard<std::mutex> lk(wsMu_);
    if (activeWorkspace_.is_object() && !activeWorkspace_.empty()) return activeWorkspace_;
  }
  std::string cw = currentCwd();
  return json{{"id", ""}, {"name", leafName(cw)}, {"folders", json::array({cw})}};
}

// 切到某个工作空间：cwd 用 folders[0]，除非显式指定了本空间里的另一个文件夹
void Backend::activateWorkspace(const json& ws, bool persist, const std::string& preferredCwd) {
  if (!ws.is_object() || ws.empty()) return;
  auto folders = foldersOf(ws);
  if (folders.empty()) return;

  std::string target = folders[0];
  if (!preferredCwd.empty()) {
    for (const auto& f : folders) {
      if (pathKey(f) == pathKey(preferredCwd)) {
        target = f;
        break;
      }
    }
  }
  {
    std::lock_guard<std::mutex> lk(wsMu_);
    activeWorkspace_ = ws;
  }
  {
    std::lock_guard<std::mutex> lk(cwdMu_);
    cwd_ = target;
  }
  {
    std::lock_guard<std::mutex> lk(modelMu_);
    spareAcp_ = json::object();
  }
  if (persist) {
    saveSetting("lastWorkspace", target);
    saveSetting("lastWorkspaceId", jstr(ws, "id"));
  }
  logf("工作空间 -> " + jstr(ws, "name", leafName(target)) + " (" + target + ")");
}

void Backend::resolveInitialWorkspace() {
  std::string explicitPath;
  {
    std::lock_guard<std::mutex> lk(cwdMu_);
    explicitPath = cwd_;
  }

  json target;
  if (!explicitPath.empty()) {
    target = workspaceByFolder(explicitPath);
    if (target.empty()) {
      target = {{"id", ""}, {"name", leafName(explicitPath)}, {"folders", json::array({explicitPath})}};
    }
    activateWorkspace(target, true, explicitPath);
    return;
  }

  json settings = readJsonFile(settingsPath());
  std::string lastId = jstr(settings, "lastWorkspaceId");
  if (!lastId.empty()) target = findWorkspace(lastId);
  if (target.empty()) {
    std::string last = jstr(settings, "lastWorkspace");
    if (!last.empty() && isDirectoryPath(last)) target = workspaceByFolder(last);
    if (target.empty() && !last.empty() && isDirectoryPath(last)) {
      target = {{"id", ""}, {"name", leafName(last)}, {"folders", json::array({last})}};
    }
  }
  if (target.empty()) {
    // 没记过偏好时跟随最近一次会话所在目录，最后才退回 exe 目录
    std::string recent;
    int64_t at = 0;
    auto arrIt = store_.find("sessions");
    if (arrIt != store_.end() && arrIt->is_array()) {
      for (const auto& s : *arrIt) {
        if (!s.is_object()) continue;
        std::string c = jstr(s, "cwd");
        int64_t t = s.value("updatedAt", static_cast<int64_t>(0));
        if (t >= at && !c.empty() && isDirectoryPath(c)) {
          at = t;
          recent = c;
        }
      }
    }
    std::string dir = recent.empty() ? exeDir() : recent;
    target = {{"id", ""}, {"name", leafName(dir)}, {"folders", json::array({dir})}};
  }
  activateWorkspace(target, false);
}

void Backend::initStore() {
  json doc = loadStoreFile(localAppDir() + "\\sessions.json");
  if (doc.is_object() && !doc.empty()) {
    store_ = doc;
  } else {
    store_ = json{{"sessions", json::array()}, {"lastSessionId", ""}};
  }

  // 一次性把历史里逐 token 落盘的事件压掉（老版本升级上来的数据）
  size_t before = 0, after = 0;
  json& arr = store_["sessions"];
  if (arr.is_array()) {
    for (auto& s : arr) {
      if (!s.is_object()) continue;
      json& evs = s["events"];
      if (!evs.is_array() || evs.empty()) continue;
      before += compactSessionEvents(evs, kSessionEventCap);
      after += evs.size();
    }
  }
  if (before != after) {
    logf("会话事件压缩 " + std::to_string(before) + " -> " + std::to_string(after));
    saveStore();
  }
}

void Backend::saveStore() {
  json snapshot;
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    snapshot = store_;
  }
  std::string path = localAppDir() + "\\sessions.json";
  std::string tmp = path + ".tmp";

  // 多窗口是多个进程，各自持有一份内存 store。这里用命名互斥锁串行化写入，
  // 并把磁盘上的新会话合并进来，避免后写的窗口把先写的整份覆盖掉。
  HANDLE mtx = CreateMutexA(nullptr, FALSE, "Local\\WorkBuddyLiteStore");
  if (mtx) WaitForSingleObject(mtx, 5000);

  json disk = loadStoreFile(path);
  std::map<std::string, json> byId;
  for (const auto& s : jval(disk, "sessions", json::array())) {
    std::string id = jstr(s, "id");
    if (!id.empty()) byId[id] = s;
  }
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    for (const auto& id : deletedIds_) byId.erase(id);
  }
  for (const auto& s : jval(snapshot, "sessions", json::array())) {
    std::string id = jstr(s, "id");
    if (id.empty()) continue;
    auto it = byId.find(id);
    if (it == byId.end() ||
        s.value("updatedAt", static_cast<int64_t>(0)) >=
            it->second.value("updatedAt", static_cast<int64_t>(0))) {
      byId[id] = s;
    }
  }

  std::vector<json> list;
  list.reserve(byId.size());
  for (auto& [id, s] : byId) list.push_back(s);
  std::sort(list.begin(), list.end(), [](const json& a, const json& b) {
    return a.value("updatedAt", static_cast<int64_t>(0)) <
           b.value("updatedAt", static_cast<int64_t>(0));
  });
  json merged = {{"sessions", json::array()},
                 {"lastSessionId", jstr(snapshot, "lastSessionId", jstr(disk, "lastSessionId"))}};
  for (auto& s : list) merged["sessions"].push_back(s);

  std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
  if (out) {
    out << dumpJson(merged);
    out.close();
    MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);
  }

  {
    std::lock_guard<std::mutex> lk(storeMu_);
    store_ = merged;
    deletedIds_.clear();
  }
  if (mtx) {
    ReleaseMutex(mtx);
    CloseHandle(mtx);
  }
}

bool Backend::start() {
  setupRoutes();
  port_ = srv_.bind_to_any_port("127.0.0.1");
  if (port_ <= 0) {
    logf("bind_to_any_port 失败");
    return false;
  }
  listenThread_ = std::thread([this] { srv_.listen_after_bind(); });
  logf("http server on " + url());
  // 给外部工具（agent 的 browser CLI）一个稳定的入口
  {
    std::ofstream out(localAppDir() + "\\port.txt", std::ios::binary | std::ios::trunc);
    if (out) out << port_;
  }

  // 预热 Agent（演示模式跳过）
  if (!demo_) {
    std::string err;
    std::thread([this] {
      std::string e;
      if (!ensureAgent(e)) {
        logf("agent 预热失败: " + e);
        return;
      }
      // 顺手把两个慢接口预热，界面第一次打开用量/工作空间就能直接命中缓存
      agentRecents();
      cliStats();
    }).detach();
  }
  return true;
}

void Backend::stop() {
  if (stopped_.exchange(true)) return;
  srv_.stop();
  if (listenThread_.joinable()) listenThread_.join();
  saveStore();
  if (client_) client_->close();
  if (host_) host_->stop();
}

std::string Backend::statusText() const {
  if (demo_) return "演示模式";
  if (agentReady_) return "已连接 CodeBuddy";
  return agentError_.empty() ? "正在启动 Agent…" : agentError_;
}

bool Backend::ensureAgent(std::string& err) {
  std::lock_guard<std::mutex> lk(agentMu_);
  if (client_ && client_->isOpen()) {
    agentReady_ = true;
    return true;
  }
  try {
    if (!host_) host_ = std::make_unique<AgentHost>();
    if (!host_->ready()) host_->start();
    if (!client_) client_ = std::make_unique<AcpClient>();
    if (!client_->isOpen()) {
      client_->open(host_->baseUrl());
      wireAgentCallbacks();
      // 重连后旧的预热会话已经失效，别拿去发 prompt
      std::lock_guard<std::mutex> ml(modelMu_);
      spareAcp_ = json::object();
    }
    agentReady_ = true;
    agentError_.clear();
    return true;
  } catch (const std::exception& e) {
    agentReady_ = false;
    agentError_ = e.what();
    err = agentError_;
    logf(std::string("ensureAgent 失败: ") + e.what());
    return false;
  }
}

void Backend::wireAgentCallbacks() {
  if (!client_) return;
  client_->onUpdate([this](const json& update, const std::string& acpSid) {
    NormalizedEvent ev = normalizeUpdate(update, acpSid);
    if (!ev.valid) return;
    if (ev.type == "text") {
      // AI 整理用临时会话：文本不进 UI，只在这里收集
      std::lock_guard<std::mutex> lk(aiTextMu_);
      auto it = aiText_.find(acpSid);
      if (it != aiText_.end()) it->second += jstr(ev.data, "text");
    }
    if (ev.type == "config") {
      // config_option_update 是全量快照，也是这条会话最权威的配置来源；
      // 子代理/团队成员的配置不参与主会话快照。
      json meta = jval(update, "_meta", json::object());
      const bool memberEvent = meta.is_object() && meta.contains("codebuddy.ai/memberEvent");
      json options = jval(ev.data, "options", json::array());
      if (!memberEvent) {
        if (options.is_array() && !options.empty()) {
          std::lock_guard<std::mutex> lk(modelMu_);
          configOptions_ = options;
        }
        // 顺手记下当前模型；configOptions 里也带 model 的完整选项
        for (const auto& opt : options) {
          if (jstr(opt, "id") == "model") {
            std::string cur = jstr(opt, "currentValue");
            if (!cur.empty()) {
              std::lock_guard<std::mutex> lk(modelMu_);
              if (selectedModel_.empty()) selectedModel_ = cur;
            }
          }
        }
      }
    } else if (ev.type == "models") {
      // ACP 主动推送的模型目录（切换/刷新时）
      json arr = jval(ev.data, "models", json::array());
      if (arr.is_array() && !arr.empty()) setModelCatalog(arr, jstr(ev.data, "currentId"));
    }
    std::string uiId;
    {
      std::lock_guard<std::mutex> lk(mapMu_);
      auto it = acpToUi_.find(acpSid);
      if (it != acpToUi_.end()) uiId = it->second;
    }
    if (uiId.empty()) return;
    // normalize 打的是 ACP 会话 id，前端只认 UI 会话 id；这里统一改写成 UI id，
    // 否则带 sessionId 的载荷（例如 usage）会被前端当成别的会话整条丢掉
    ev.data["sessionId"] = uiId;
    emit(uiId, ev.type, ev.data);
  });

  client_->onAgentRequest([this](int64_t id, const std::string& method, const json& params) {
    if (method != "session/request_permission") {
      client_->reply(id, json::object());
      return;
    }
    std::string acpSid = jstr(params, "sessionId");
    std::string uiId;
    {
      std::lock_guard<std::mutex> lk(mapMu_);
      auto it = acpToUi_.find(acpSid);
      if (it != acpToUi_.end()) uiId = it->second;
    }
    if (uiId.empty()) {
      client_->reply(id, json{{"outcome", {{"outcome", "cancelled"}}}});
      return;
    }
    std::string requestId = "perm_" + std::to_string(id);
    {
      std::lock_guard<std::mutex> lk(mapMu_);
      pendingPerm_[requestId] = {id, uiId};
    }
    json toolCall = jval(params, "toolCall", json::object());
    json options = json::array();
    for (const auto& o : jval(params, "options", json::array())) {
      options.push_back({{"optionId", jstr(o, "optionId")},
                         {"name", jstr(o, "name", jstr(o, "optionId"))},
                         {"kind", jstr(o, "kind")}});
    }
    emit(uiId, "permission",
         json{{"requestId", requestId},
              {"title", jstr(toolCall, "title", "需要授权")},
              {"kind", jstr(toolCall, "kind")},
              {"toolCallId", jstr(toolCall, "toolCallId")},
              {"options", options}});
  });
}

std::string Backend::selectedModel() const {
  std::lock_guard<std::mutex> lk(modelMu_);
  return selectedModel_;
}

void Backend::setModelCatalog(const json& availableModels, const std::string& currentId) {
  json list = json::array();
  if (availableModels.is_array()) {
    for (const auto& m : availableModels) {
      if (m.is_object()) list.push_back(modelEntry(m));
    }
  }
  if (list.empty()) return;
  std::lock_guard<std::mutex> lk(modelMu_);
  modelCatalog_ = {{"models", list}, {"currentId", currentId}};
  if (selectedModel_.empty() && !currentId.empty()) selectedModel_ = currentId;
}

void Backend::absorbSessionInfo(const json& info, const std::string& uiId) {
  if (!info.is_object()) return;
  json models = jval(info, "models", json::object());
  if (models.is_object()) {
    json available = jval(models, "availableModels", json::array());
    setModelCatalog(available, jstr(models, "currentModelId"));
  }
  json configOptions = jval(info, "configOptions", json::array());
  if (configOptions.is_array() && !configOptions.empty()) {
    {
      std::lock_guard<std::mutex> lk(modelMu_);
      configOptions_ = configOptions;
    }
    if (!uiId.empty()) emit(uiId, "config", json{{"options", configOptions}});
  }
}

json Backend::takeSpareSession(const std::string& cwd) {
  std::lock_guard<std::mutex> lk(modelMu_);
  if (!spareAcp_.is_object() || spareAcp_.empty()) return json::object();
  if (!samePath(jstr(spareAcp_, "cwd"), cwd)) return json::object();
  json info = jval(spareAcp_, "info", json::object());
  spareAcp_ = json::object();
  return info;
}

bool Backend::ensureModelCatalog(std::string& err) {
  if (demo_) {
    std::lock_guard<std::mutex> lk(modelMu_);
    modelCatalog_ = {{"models", demoModels()}, {"currentId", "deepseek-v4.1-flash"}};
    // 只在首次填充；否则每次 /api/models 都会把用户改过的档位冲掉
    if (!configOptions_.is_array() || configOptions_.empty()) configOptions_ = demoConfigOptions();
    if (selectedModel_.empty()) selectedModel_ = "deepseek-v4.1-flash";
    return true;
  }
  {
    std::lock_guard<std::mutex> lk(modelMu_);
    if (!jval(modelCatalog_, "models", json::array()).empty()) return true;
  }

  const std::string cwd = currentCwd();
  json info = json::object();
  {
    std::lock_guard<std::mutex> lk(modelMu_);
    if (!spareAcp_.is_object() || spareAcp_.empty() || !samePath(jstr(spareAcp_, "cwd"), cwd)) {
      // 没有可复用会话
    } else {
      info = jval(spareAcp_, "info", json::object());
    }
  }
  if (!info.is_object() || info.empty()) {
    if (!ensureAgent(err)) return false;
    try {
      info = client_->newSessionInfo(cwd, teamMcpServers());
    } catch (const std::exception& e) {
      err = e.what();
      return false;
    }
    if (!info.is_object() || info.empty()) {
      err = "读取模型目录失败";
      return false;
    }
    std::lock_guard<std::mutex> lk(modelMu_);
    spareAcp_ = {{"cwd", cwd}, {"info", info}};
  }
  absorbSessionInfo(info, "");
  return true;
}

json Backend::latestQuota() {
  json quota = json::object();
  int64_t best = 0;
  std::lock_guard<std::mutex> lk(storeMu_);
  for (const auto& s : jval(store_, "sessions", json::array())) {
    json u = jval(s, "usage", json::object());
    json q = jval(u, "quota", json::object());
    if (!q.is_object() || q.empty()) continue;
    json last = jval(u, "lastTurn", json::object());
    int64_t at = static_cast<int64_t>(numAt(last, "at", 0));
    if (at == 0) at = s.value("updatedAt", static_cast<int64_t>(0));
    if (at >= best) {
      best = at;
      quota = q;
    }
  }
  return quota;
}

json Backend::usageSummary() {
  const std::string cw = currentCwd();
  const std::string today = todayKey();
  double totalCredits = 0, totalCharged = 0, todayCredits = 0;
  double workspaceCredits = 0, workspaceCharged = 0, workspaceToday = 0;
  json list = json::array();
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    auto arrIt = store_.find("sessions");
    if (arrIt != store_.end() && arrIt->is_array()) {
      for (const auto& s : *arrIt) {
        json u = jval(s, "usage", json::object());
        double credits = numAt(u, "credits", 0);
        double charged = numAt(u, "charged", 0);
        double todayCredit = 0;
        json daily = jval(u, "daily", json::object());
        if (daily.is_object()) todayCredit = numAt(daily, today.c_str(), 0);
        totalCredits += credits;
        totalCharged += charged;
        todayCredits += todayCredit;
        bool here = samePath(jstr(s, "cwd"), cw);
        if (here) {
          workspaceCredits += credits;
          workspaceCharged += charged;
          workspaceToday += todayCredit;
        }
        list.push_back({{"id", jstr(s, "id")},
                        {"title", jstr(s, "title", "新会话")},
                        {"cwd", jstr(s, "cwd")},
                        {"credits", credits},
                        {"charged", charged},
                        {"updatedAt", s.value("updatedAt", static_cast<int64_t>(0))},
                        {"inWorkspace", here}});
      }
    }
  }
  std::sort(list.begin(), list.end(), [](const json& a, const json& b) {
    return numAt(a, "credits", 0) > numAt(b, "credits", 0);
  });
  json top = json::array();
  for (size_t i = 0; i < list.size() && i < 8; ++i) top.push_back(list[i]);

  json out = {{"workspace", cw},
              {"totalCredits", totalCredits},
              {"totalCharged", totalCharged},
              {"todayCredits", todayCredits},
              {"workspaceCredits", workspaceCredits},
              {"workspaceCharged", workspaceCharged},
              {"workspaceToday", workspaceToday},
              {"sessions", top},
              {"quota", latestQuota()},
              {"model", selectedModel()}};

  if (!demo_) {
    json stats = cliStats();
    if (stats.is_object() && !stats.empty()) {
      auto sv = [&](const char* key) -> int64_t {
        auto it = stats.find(key);
        return (it != stats.end() && it->is_number()) ? it->get<int64_t>() : 0;
      };
      out["cliStats"] = {{"totalSessions", sv("totalSessions")},
                         {"totalMessages", sv("totalMessages")},
                         {"totalDays", sv("totalDays")},
                         {"activeDays", sv("activeDays")},
                         {"modelUsage", jval(stats, "modelUsage", json::object())}};
    }
  }
  return out;
}

json Backend::agentGet(const std::string& path) {
  if (!host_ || !host_->ready()) return json::object();
  try {
    httplib::Client cli(host_->baseUrl());
    cli.set_connection_timeout(2, 0);
    cli.set_read_timeout(8, 0);
    auto res = cli.Get(path.c_str(), httplib::Headers{{"X-CodeBuddy-Request", "1"}});
    if (!res || res->status != 200) return json::object();
    json doc = json::parse(res->body, nullptr, false);
    if (doc.is_discarded() || !doc.is_object()) return json::object();
    json data = jval(doc, "data", json());
    if (data.is_object() || data.is_array()) return data;
    return doc;
  } catch (...) {
    return json::object();
  }
}

json Backend::agentSend(const std::string& method, const std::string& path, const json& body,
                        int timeoutSec) {
  if (!host_ || !host_->ready()) return json{{"status", 0}, {"error", "CLI 未就绪"}};
  try {
    httplib::Client cli(host_->baseUrl());
    cli.set_connection_timeout(3, 0);
    cli.set_read_timeout(timeoutSec, 0);
    cli.set_write_timeout(timeoutSec, 0);
    httplib::Headers headers{{"X-CodeBuddy-Request", "1"}};
    const std::string payload = body.is_null() ? std::string() : dumpJson(body);
    httplib::Result res;
    if (method == "POST") {
      res = cli.Post(path.c_str(), headers, payload, "application/json");
    } else if (method == "PATCH") {
      res = cli.Patch(path.c_str(), headers, payload, "application/json");
    } else {
      res = cli.Get(path.c_str(), headers);
    }
    if (!res) {
      const bool timeout = res.error() == httplib::Error::Read;
      return json{{"status", 0},
                  {"error", timeout ? "CLI 响应超时" : "CLI 连接中断"},
                  {"timeout", timeout}};
    }
    json doc = json::parse(res->body, nullptr, false);
    if (doc.is_discarded()) doc = json::object();
    return json{{"status", res->status}, {"doc", doc}};
  } catch (const std::exception& e) {
    return json{{"status", 0}, {"error", e.what()}};
  }
}

json Backend::teamMcpServers() const {
  // 只给普通聊天会话注入；demo 没有 agent，返回空数组。
  // ACP 的 stdio server 不能带 "type" 字段：CLI 的 convertAcpMcpServersToDynamic
  // 见到 type 只认 http/sse，其余会被直接跳过，所以这里只写 name/command/args/env。
  if (demo_ || exePath_.empty() || port_ <= 0) return json::array();
  json env = json::array();
  env.push_back({{"name", "WBL_TEAM_PORT"}, {"value", std::to_string(port_)}});
  env.push_back({{"name", "WBL_TEAM_DATA"}, {"value", localAppDir()}});
  return json::array({{{"name", "team"},
                       {"command", exePath_},
                       {"args", json::array({"--mcp-team"})},
                       {"env", env}}});
}

namespace {

// 频道 / 成员 id 是 UUID；只放行 URL 安全字符，避免把参数拼进路径时被注入
bool teamIdOk(const std::string& id) {
  if (id.empty() || id.size() > 80) return false;
  for (unsigned char c : id) {
    if (!(std::isalnum(c) || c == '-' || c == '_')) return false;
  }
  return true;
}

std::string teamErrorText(const json& doc) {
  json err = jval(doc, "error", json::object());
  std::string msg = jstr(err, "message");
  if (msg.empty()) msg = jstr(err, "code");
  if (msg.empty()) msg = jstr(doc, "error");
  return msg.empty() ? "频道服务返回未知错误" : msg;
}

// 上游 doc 的 message 是英文；这里把可预见的几种翻成中文，其余原样带回，至少能定位。
std::string teamWriteErrorText(const json& doc, const std::string& fallback) {
  json err = jval(doc, "error", json::object());
  const std::string code = jstr(err, "code");
  const std::string msg = jstr(err, "message");
  if (code == "CHANNEL_NOT_FOUND") return "频道不存在或已被删除";
  if (code == "AGENT_NOT_FOUND") return "智能体不存在或已被删除";
  if (code == "CHANNEL_REVISION_CONFLICT") return "频道刚被其他窗口修改，请刷新后重试";
  if (code == "CHANNEL_LIFECYCLE_INVALID") return "频道当前不接受修改（可能已归档）";
  if (code == "MEMBER_NOT_ALLOWED") return "默认分身不能加入频道，请换一个成员";
  if (code == "CHANNEL_MEMBERS") return "频道成员数量不合法（至少 2 个，且不超过上限）";
  if (code == "PERMISSION_MODE_NOT_ALLOWED") return "这个权限模式不被允许";
  if (msg.find("leadAgentId") != std::string::npos) return "组长必须是频道成员";
  if (msg.find("existing agent") != std::string::npos) return "成员必须在智能体名册里";
  if (msg.find("systemPrompt") != std::string::npos) return "系统提示词格式不合法";
  if (!msg.empty()) return msg;
  return fallback.empty() ? "频道服务返回未知错误" : fallback;
}

json teamLocalMessage(const std::string& text, const json& mentions, const std::string& id) {
  json msg = {{"id", id}, {"at", nowMs()}, {"from", "user"}, {"text", text}};
  if (mentions.is_array() && !mentions.empty()) msg["mentionAgentIds"] = mentions;
  return msg;
}

}  // namespace

namespace {

// 未读游标与界面状态共用 ui-state.json：用户明确要求复用已有机制，不另建库。
// 读改写都在这把命名互斥量里完成，避免和 handleUiStateSet 互相覆盖。
void mutateUiStateDoc(const std::function<void(json&)>& fn) {
  const std::string path = localAppDir() + "\\ui-state.json";
  const std::string tmp = path + ".tmp";
  HANDLE mtx = CreateMutexA(nullptr, FALSE, "Local\\WorkBuddyLiteUiState");
  if (mtx) WaitForSingleObject(mtx, 5000);
  json doc = readJsonFile(path);
  if (!doc.is_object()) doc = json::object();
  fn(doc);
  doc["updatedAt"] = nowMs();
  std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
  if (out) {
    out << dumpJson(doc);
    out.close();
    MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);
  }
  if (mtx) {
    ReleaseMutex(mtx);
    CloseHandle(mtx);
  }
}
json teamReadDoc() {
  json doc = readJsonFile(localAppDir() + "\\ui-state.json");
  json state = jval(doc, "teamRead", json::object());
  return state.is_object() ? state : json::object();
}

}  // namespace

json Backend::trimTeamAgent(const json& agent) {
  json out = {{"id", jstr(agent, "id")}, {"name", jstr(agent, "name")}};
  for (const char* key : {"avatarVariant", "title", "model", "permissionMode", "homeCwd"}) {
    json value = jval(agent, key);
    if (!value.is_null()) out[key] = value;
  }
  json last = jval(agent, "lastActiveAt");
  if (last.is_number()) out["lastActiveAt"] = last;
  // description 是人设正文（实测单个可达数百字，含多段），列表态不需要，直接不返回
  return out;
}

json Backend::trimTeamAgentDetail(const json& agent) {
  json out = trimTeamAgent(agent);
  // 只有详情才带人设正文；服务端上限 2000 字，原样返回，不做截断，否则编辑保存会把后半段吃掉
  out["description"] = jstr(agent, "description");
  for (const char* key : {"engine", "visibility", "createdBy"}) {
    std::string value = jstr(agent, key);
    if (!value.empty()) out[key] = value;
  }
  return out;
}

json Backend::trimTeamChannel(const json& channel) {
  json out = {{"id", jstr(channel, "id")}, {"name", jstr(channel, "name")}};
  json members = jval(channel, "memberAgentIds", json::array());
  out["memberAgentIds"] = members.is_array() ? members : json::array();
  out["leadAgentId"] = jstr(channel, "leadAgentId");
  json muted = jval(channel, "mutedAgentIds", json::array());
  out["mutedAgentIds"] = muted.is_array() ? muted : json::array();
  std::string preview = jstr(channel, "lastPreview");
  out["lastPreview"] = utf8Truncate(preview, 240);
  json active = jval(channel, "lastActiveAt");
  out["lastActiveAt"] = active.is_number() ? active : json(0);
  json unread = jval(channel, "unreadByUser");
  out["unreadByUser"] = unread.is_number() ? unread : json(0);
  out["homeCwd"] = jstr(channel, "homeCwd");
  // 写成员/组长时原样回传，避免把网页端刚做的改动静默覆盖
  json revision = jval(channel, "governanceRevision");
  if (revision.is_number()) out["governanceRevision"] = revision;
  return out;
}

json Backend::trimTeamMessage(const json& message) {
  json out = {{"id", jstr(message, "id")},
              {"at", jval(message, "at", 0)},
              {"from", jstr(message, "from", "user")},
              {"text", jstr(message, "text")}};
  for (const char* key : {"agentId", "taskId", "taskEvent", "replyTo"}) {
    std::string value = jstr(message, key);
    if (!value.empty()) out[key] = value;
  }
  json mentions = jval(message, "mentionAgentIds", json::array());
  if (mentions.is_array() && !mentions.empty()) out["mentionAgentIds"] = mentions;
  // 实测系统消息的 kind 是 "system"（文档早期写的是 "systemEvent"）；两种都归一成 system
  const std::string kind = jstr(message, "kind");
  if (kind == "system" || kind == "systemEvent") {
    out["kind"] = "system";
  } else if (!kind.empty()) {
    out["kind"] = kind;
  }
  json event = jval(message, "systemEvent", json::object());
  if (event.is_object() && !event.empty()) {
    json trimmed = {{"type", jstr(event, "type")}, {"reason", jstr(event, "reason")}};
    json names = jval(event, "names", json::array());
    if (names.is_array() && !names.empty()) trimmed["names"] = names;
    out["systemEvent"] = trimmed;
  }
  // widget / taskPayload / attachments 体积大且 v1 不渲染；text 已经能表达内容
  return out;
}

json Backend::teamStateFromCli() {
  json resp = agentSend("GET", "/api/v1/agent-home", json(), 8);
  const int status = resp.value("status", 0);
  if (status != 200) {
    std::string reason = (status == 404) ? "当前 CodeBuddy 版本没有频道接口（需要 2.184+）"
                                         : "连不上 CodeBuddy 频道服务";
    std::string detail = jstr(resp, "error");
    if (!detail.empty() && status != 404) reason += "：" + detail;
    return json{{"enabled", false},
                {"reason", reason},
                // CLI 的 --serve 是后台预热：状态 0 / 5xx 时前端值得再试几次；404 是版本不支持
                {"retry", status == 0 || status >= 500},
                {"agents", json::array()},
                {"channels", json::array()},
                {"presence", json::array()}};
  }
  json doc = jval(resp, "doc", json::object());
  json data = jval(doc, "data", json::object());
  if (!data.is_object() || data.empty()) {
    return json{{"enabled", false},
                {"reason", "频道服务没有返回数据"},
                {"retry", true},
                {"agents", json::array()},
                {"channels", json::array()},
                {"presence", json::array()}};
  }

  const std::string defaultAgentId = jstr(data, "defaultAgentId");
  json agents = json::array();
  for (const auto& agent : jval(data, "agents", json::array())) {
    if (!agent.is_object()) continue;
    if (jstr(agent, "visibility", "visible") == "hidden") continue;
    // 1:1 分身不能进频道，列表里也不展示，避免用户误 @
    if (!defaultAgentId.empty() && jstr(agent, "id") == defaultAgentId) continue;
    agents.push_back(trimTeamAgent(agent));
  }

  json channels = json::array();
  for (const auto& channel : jval(data, "channels", json::array())) {
    if (!channel.is_object()) continue;
    if (jstr(channel, "visibility", "visible") == "hidden") continue;
    channels.push_back(trimTeamChannel(channel));
  }

  json presence = json::array();
  json view = jval(data, "viewModel", json::object());
  for (const auto& item : jval(view, "presence", json::array())) {
    if (!item.is_object()) continue;
    presence.push_back({{"agentId", jstr(item, "agentId")},
                        {"availability", jstr(item, "availability", "idle")}});
  }

  json maxMembers = jval(data, "channelMaxMembers");
  {
    std::lock_guard<std::mutex> lk(teamUnreadMu_);
    teamChannelIds_.clear();
    for (const auto& channel : channels) {
      const std::string id = jstr(channel, "id");
      if (id.empty()) continue;
      teamChannelIds_.push_back(id);
      json unread = jval(channel, "unreadByUser", 0);
      teamCliUnread_[id] = unread.is_number() ? unread.get<int>() : 0;
    }
  }
  json mergedChannels = json::array();
  for (const auto& channel : channels) {
    json item = channel;
    json unread = jval(channel, "unreadByUser", 0);
    item["unreadByUser"] =
        teamUnreadCount(jstr(channel, "id"), unread.is_number() ? unread.get<int>() : 0);
    mergedChannels.push_back(item);
  }

  return json{{"enabled", data.value("enabled", true)},
              {"canCreate", true},
              // v2 写能力标记：旧后端的 state 没有这个字段，前端据此把成员面板降级为只读
              {"canManage", true},
              // v2 未读：旧后端没有 /api/team/read，前端据此退回只读未读（只显示不清零）
              {"canRead", true},
              {"orchestrationEnabled", data.value("orchestrationEnabled", false)},
              {"channelMaxMembers", maxMembers.is_number() ? maxMembers : json(12)},
              {"defaultAgentId", defaultAgentId},
              {"agents", agents},
              {"channels", mergedChannels},
              {"presence", presence}};
}

json Backend::teamPageFromCli(const std::string& channelId, const std::string& before,
                              const std::string& after, json& page) {
  std::string path = "/api/v1/agent-home/channels/" + channelId + "/messages/page";
  std::string query;
  if (!before.empty()) query += "before=" + httplib::encode_query_component(before);
  if (!after.empty()) {
    query += (query.empty() ? "" : "&");
    query += "after=" + httplib::encode_query_component(after);
  }
  if (!query.empty()) path += "?" + query;
  page = agentSend("GET", path, json(), 10);
  if (page.value("status", 0) != 200) return json::object();
  json doc = jval(page, "doc", json::object());
  json data = jval(doc, "data", json::object());
  return data.is_object() ? data : json::object();
}

void Backend::teamSeedCursor(const std::string& channelId, const std::string& after, bool reset) {
  std::lock_guard<std::mutex> lk(teamMu_);
  auto& watch = teamWatches_[channelId];
  watch.inited = true;
  if (!after.empty()) watch.after = after;
  if (reset) {
    watch.queue.clear();
    watch.seq = 0;
  }
}

// 读游标只在进程内加载一次；之后由 markRead 推进并立即落盘
void Backend::loadTeamReadCursors() {
  std::lock_guard<std::mutex> lk(teamUnreadMu_);
  if (teamReadLoaded_) return;
  teamReadLoaded_ = true;
  json doc = teamReadDoc();
  for (auto it = doc.begin(); it != doc.end(); ++it) {
    if (!it.value().is_object()) continue;
    json at = jval(it.value(), "at", 0);
    if (!at.is_number() || at.get<int64_t>() <= 0) continue;
    auto& state = teamUnreads_[it.key()];
    state.hasCursor = true;
    state.readAt = at.get<int64_t>();
  }
}

// 未读数：有本地读游标就以 pending 为准；没有（首次升级/首次启动）沿用 CLI 的 unreadByUser。
// 两者绝不相加——CLI 字段只作为迁移初值，避免侧栏出现双倍数字。
int Backend::teamUnreadCount(const std::string& channelId, int cliUnread) {
  loadTeamReadCursors();
  std::lock_guard<std::mutex> lk(teamUnreadMu_);
  auto it = teamUnreads_.find(channelId);
  if (it == teamUnreads_.end() || !it->second.hasCursor) return cliUnread;
  return static_cast<int>(it->second.pending.size());
}

void Backend::teamMarkRead(const std::string& channelId) {
  if (channelId.empty()) return;
  loadTeamReadCursors();
  int64_t readAt = 0;
  {
    std::lock_guard<std::mutex> lk(teamUnreadMu_);
    auto& state = teamUnreads_[channelId];
    readAt = state.readAt;
    if (state.lastMessageAt > readAt) readAt = state.lastMessageAt;
    for (const auto& item : state.pending) {
      json at = jval(item, "at", 0);
      if (at.is_number() && at.get<int64_t>() > readAt) readAt = at.get<int64_t>();
    }
    if (readAt <= 0) readAt = nowMs();
    state.readAt = readAt;
    state.hasCursor = true;
    state.pending.clear();
  }

  // 游标按 channelId 存在 ui-state.json 的 teamRead 下；重启后靠它恢复未读
  mutateUiStateDoc([&](json& doc) {
    json cursors = jval(doc, "teamRead", json::object());
    if (!cursors.is_object()) cursors = json::object();
    cursors[channelId] = {{"at", readAt}};
    doc["teamRead"] = cursors;
  });

  if (demo_) {
    std::lock_guard<std::mutex> lk(teamMu_);
    for (auto& item : demoTeam_["channels"]) {
      if (jstr(item, "id") == channelId) item["unreadByUser"] = 0;
    }
    return;
  }

  // CLI 的 unreadByUser 只会被显式写；用户确实读了才顺手清零，让网页端/桌面端
  // 不再看到过期红点。失败不影响本地游标。
  int cliUnread = 0;
  {
    std::lock_guard<std::mutex> lk(teamUnreadMu_);
    cliUnread = teamCliUnread_[channelId];
  }
  if (cliUnread <= 0) return;
  json resp = agentSend("PATCH", "/api/v1/agent-home/channels/" + channelId,
                        json{{"unreadByUser", 0}}, 5);
  if (resp.value("status", 0) == 200) {
    std::lock_guard<std::mutex> lk(teamUnreadMu_);
    teamCliUnread_[channelId] = 0;
  }
}

// 后台没有常驻线程：前端每 4s 调一次 /api/team/unread，这里按需增量扫描。
// 首次扫描读整页历史（最多 218 条）回填离线未读，之后只走 messages/page?after= 的增量。
void Backend::refreshTeamUnread() {
  loadTeamReadCursors();
  const int64_t now = nowMs();
  std::vector<std::string> ids;
  {
    std::lock_guard<std::mutex> lk(teamUnreadMu_);
    if (now - teamUnreadScannedAt_ < 1200) return;
    teamUnreadScannedAt_ = now;
    ids = teamChannelIds_;
  }
  if (ids.empty()) return;
  if (demo_) {
    demoTeamFlush();
  } else if (!host_ || !host_->ready()) {
    return;
  }

  for (const auto& id : ids) {
    if (id.empty()) continue;
    bool inited = false;
    std::string after;
    int64_t lastMessageAt = 0;
    {
      std::lock_guard<std::mutex> lk(teamUnreadMu_);
      auto& state = teamUnreads_[id];
      inited = state.inited;
      after = state.after;
      lastMessageAt = state.lastMessageAt;
    }

    json list = json::array();
    std::string nextAfter = after;
    if (demo_) {
      std::lock_guard<std::mutex> lk(teamMu_);
      json messages = jval(demoTeam_, "messages", json::object());
      if (messages.contains(id) && messages[id].is_array()) {
        for (const auto& message : messages[id]) {
          json at = jval(message, "at", 0);
          if (!inited) {
            list.push_back(message);
          } else if (at.is_number() && at.get<int64_t>() > lastMessageAt) {
            list.push_back(message);
          }
        }
      }
    } else {
      json pageResp;
      json page = teamPageFromCli(id, "", inited ? after : "", pageResp);
      if (pageResp.value("status", 0) != 200) continue;
      list = jval(page, "messages", json::array());
      nextAfter = jstr(page, "after", after);
    }

    std::lock_guard<std::mutex> lk(teamUnreadMu_);
    auto& state = teamUnreads_[id];
    if (!nextAfter.empty()) state.after = nextAfter;
    state.inited = true;
    for (const auto& message : list) {
      if (!message.is_object()) continue;
      const std::string mid = jstr(message, "id");
      if (mid.empty()) continue;
      json atValue = jval(message, "at", 0);
      const int64_t at = atValue.is_number() ? atValue.get<int64_t>() : 0;
      if (at > state.lastMessageAt) state.lastMessageAt = at;
      // 没有读游标时保留 CLI 的 unreadByUser 作为迁移初值，不把整页历史算成未读
      if (!state.hasCursor) continue;
      if (jstr(message, "from") == "user") continue;
      if (at <= state.readAt) continue;
      bool seen = false;
      for (const auto& item : state.pending) {
        if (jstr(item, "id") == mid) {
          seen = true;
          break;
        }
      }
      if (seen) continue;
      state.pending.push_back({{"id", mid}, {"at", at}});
    }
    while (state.pending.size() > 500) state.pending.pop_front();
  }
}

void Backend::initDemoTeam() {
  auto agent = [](const std::string& id, const std::string& name, int variant, const std::string& title,
                  const std::string& model, const std::string& description) {
    return json{{"id", id},
                {"name", name},
                {"avatarVariant", variant},
                {"title", title},
                {"model", model},
                {"permissionMode", "fullAccess"},
                {"homeCwd", "d:/work/falcon"},
                {"description", description},
                {"createdBy", "user"},
                {"lastActiveAt", nowMs() - 3600000}};
  };
  json agents = json::array(
      {agent("demo-agent-review", "评审", 2, "接口与安全评审", "deepseek-v4.1-flash",
             "你是接口与安全评审。\n\n职责：动手前把接口契约、错误码、鉴权边界定清楚；对高风险改动给出明确的取舍。\n\n输出要求：先给结论，再给依据；引用文件时写路径和行号。"),
       agent("demo-agent-backend", "后端", 4, "服务端与接口实现", "deepseek-v4.1-flash",
             "你是服务端与接口实现。\n\n职责：按契约写 stub 与实现，补失败路径和幂等；不确定的地方先问，不要猜。\n\n风格：改动尽量小，先保证可回滚。"),
       agent("demo-agent-frontend", "前端", 1, "Web 与交互实现", "glm-5.3",
             "你是 Web 与交互实现。\n\n职责：把状态、空态、错误态都补齐；按仓库的设计 token 写样式，不引入新颜色。\n\n验收：每个改动都要有截图或可复现步骤。"),
       agent("demo-agent-sec", "安全", 5, "鉴权与风险复核", "hy4std",
             "你是鉴权与风险复核。\n\n职责：检查密钥、权限、依赖与发布包边界；发现风险时给出可执行的修复建议。\n\n口径：只报能被验证的问题，不放大猜测。")});

  const std::string cwd = "d:/work/falcon";
  json channels = json::array(
      {{{"id", "demo-1"},
        {"name", "项目 Falcon"},
        {"memberAgentIds", json::array({"demo-agent-review", "demo-agent-backend", "demo-agent-frontend",
                                        "demo-agent-sec"})},
        {"leadAgentId", "demo-agent-review"},
        {"mutedAgentIds", json::array()},
        {"lastPreview", "评审 完成了接口契约评审"},
        {"lastActiveAt", nowMs() - 120000},
        {"unreadByUser", 3},
        {"homeCwd", cwd}},
       {{"id", "demo-2"},
        {"name", "发布值守"},
        {"memberAgentIds", json::array({"demo-agent-backend", "demo-agent-frontend", "demo-agent-sec"})},
        {"leadAgentId", ""},
        {"mutedAgentIds", json::array()},
        {"lastPreview", "后端 已冻结 main，等 CI 绿"},
        {"lastActiveAt", nowMs() - 900000},
        {"unreadByUser", 0},
        {"homeCwd", cwd}}});

  // demo 消息时间固定到当天（UTC 零点 + 2 分钟），同一天内重启不会把「已读」冲掉；
  // 否则每次启动 base 都往后移，持久化的读游标永远追不上。
  const int64_t demoNow = nowMs();
  const int64_t base = demoNow - (demoNow % 86400000) + 120000;
  auto user = [&](int64_t at, const std::string& text, const json& mentions = json::array()) {
    json m = {{"id", "demo-m-" + std::to_string(at) + "-u"}, {"at", at}, {"from", "user"}, {"text", text}};
    if (!mentions.empty()) m["mentionAgentIds"] = mentions;
    return m;
  };
  auto bot = [&](int64_t at, const std::string& agentId, const std::string& text) {
    return json{{"id", "demo-m-" + std::to_string(at) + "-" + agentId},
                {"at", at},
                {"from", "agent"},
                {"agentId", agentId},
                {"text", text}};
  };
  auto sys = [&](int64_t at, const std::string& text, const std::string& type, const std::string& reason,
                 const json& names) {
    return json{{"id", "demo-s-" + std::to_string(at)},
                {"at", at},
                {"from", "system"},
                {"kind", "system"},
                {"text", text},
                {"systemEvent", {{"type", type}, {"reason", reason}, {"names", names}}}};
  };

  json main = json::array();
  main.push_back(user(base, "@评审 先看接口契约，安全那块交给 @后端",
                      json::array({"demo-agent-review", "demo-agent-backend"})));
  main.push_back(bot(base + 40000, "demo-agent-review",
                     "我先看接口契约，安全那块归 @后端。\n\n- 入参统一用 `traceId`\n- 失败路径必须有错误码"));
  main.push_back(bot(base + 55000, "demo-agent-review",
                     "接口清单我列在 `docs/api-contract.md`，先按这个对。"));
  main.push_back(bot(base + 90000, "demo-agent-backend", "收到，15 分钟后给初版。"));
  main.push_back(user(base + 150000, "先按上周的方案走"));
  main.push_back(sys(base + 160000, "评审 把这一棒交给 后端", "room-handoff", "handoff",
                     json::array({"评审", "后端"})));
  main.push_back(bot(base + 220000, "demo-agent-backend",
                     "接口 stub 已放到 `api/stub/openapi.yaml`，字段先按契约留空。"));
  main.push_back(sys(base + 300000, "本轮超时收场（轮到 安全 时未见回应）。", "room-turn-ended", "timeout",
                     json::array({"安全"})));
  main.push_back(user(base + 380000, "@安全 帮忙看下鉴权那块", json::array({"demo-agent-sec"})));
  main.push_back(bot(base + 440000, "demo-agent-sec",
                     "鉴权走 mTLS；本地联调用 dev 证书，别把生产 CA 带进仓库。"));
  main.push_back(bot(base + 520000, "demo-agent-review",
                     "补充一条：`POST /orders` 的幂等键用 `Idempotency-Key`，不要塞进 body。\n\n```http\nIdempotency-Key: 7f3c…\n```"));
  main.push_back(user(base + 600000, "好，按这个改"));
  main.push_back(sys(base + 660000, "评审 完成了 t3「接口契约」", "task-event", "completed",
                     json::array({"评审"})));
  main.push_back(bot(base + 720000, "demo-agent-backend", "改完了，回滚脚本也一起加了。"));
  main.push_back(user(base + 790000, "@all 明天十点前把自测结论贴上来",
                      json::array({"demo-agent-review", "demo-agent-backend", "demo-agent-frontend",
                                   "demo-agent-sec"})));
  main.push_back(bot(base + 850000, "demo-agent-frontend", "前端这边把空态和错误态都补了，明早贴截图。"));
  main.push_back(bot(base + 870000, "demo-agent-frontend",
                     "截图放在 `docs/ui/team-empty.png`，今晚再补一张深色。"));
  main.push_back(sys(base + 900000, "本轮收场：所有被叫到的成员都已回复。", "room-turn-ended", "done",
                     json::array({"评审", "前端"})));
  // 引用示例：回复用户「好，按这个改」；再让用户引用这条成员消息。
  // CLI 的 replyTo 就是消息 id，消息行据此渲染引用块并支持跳转。
  const std::string quoteUserId = "demo-m-" + std::to_string(base + 600000) + "-u";
  const std::string quoteBotId = "demo-m-" + std::to_string(base + 930000) + "-demo-agent-review";
  main.push_back(json{{"id", quoteBotId},
                      {"at", base + 930000},
                      {"from", "agent"},
                      {"agentId", "demo-agent-review"},
                      {"replyTo", quoteUserId},
                      {"text", "按上一条说的改完了：`POST /orders` 的幂等键挪到 header，body 不再带。"}});
  main.push_back(json{{"id", "demo-m-" + std::to_string(base + 970000) + "-u"},
                      {"at", base + 970000},
                      {"from", "user"},
                      {"text", "这条结论贴到发布清单里"},
                      {"replyTo", quoteBotId}});

  json release = json::array();
  release.push_back(user(base + 1000000, "发布窗口定在周四 20:00，先冻 main。"));
  release.push_back(bot(base + 1050000, "demo-agent-backend", "已冻结 main，等 CI 绿。"));
  release.push_back(sys(base + 1100000, "本轮收场。", "room-turn-ended", "done", json::array({"后端"})));
  release.push_back(bot(base + 1160000, "demo-agent-frontend", "回滚脚本已就位，`scripts/rollback.ps1`。"));
  release.push_back(user(base + 1220000, "@安全 帮看下发布前的权限清单", json::array({"demo-agent-sec"})));
  release.push_back(bot(base + 1280000, "demo-agent-sec", "清单没问题；生产密钥走 KMS，不在发布包里。"));

  std::lock_guard<std::mutex> lk(teamMu_);
  demoTeam_ = json{{"agents", agents},
                   {"channels", channels},
                   {"messages", {{"demo-1", main}, {"demo-2", release}}},
                   {"pending", json::array()}};
  teamWatches_.clear();
}

json Backend::demoTeamState() {
  json presence = json::array();
  json agents = json::array();
  json channels = json::array();
  {
    std::lock_guard<std::mutex> lk(teamMu_);
    for (const auto& agent : jval(demoTeam_, "agents", json::array())) {
      const std::string id = jstr(agent, "id");
      presence.push_back({{"agentId", id}, {"availability", id == "demo-agent-sec" ? "offline" : "active"}});
      // 与真实路径一致：列表态不返回 description，详情走 GET /api/team/agent
      agents.push_back(trimTeamAgent(agent));
    }
    channels = jval(demoTeam_, "channels", json::array());
  }
  {
    std::lock_guard<std::mutex> lk(teamUnreadMu_);
    teamChannelIds_.clear();
    for (const auto& item : channels) {
      const std::string id = jstr(item, "id");
      if (id.empty()) continue;
      teamChannelIds_.push_back(id);
      json unread = jval(item, "unreadByUser", 0);
      teamCliUnread_[id] = unread.is_number() ? unread.get<int>() : 0;
    }
  }

  json list = json::array();
  for (const auto& item : channels) {
    json channel = trimTeamChannel(item);
    json unread = jval(item, "unreadByUser", 0);
    channel["unreadByUser"] = teamUnreadCount(jstr(item, "id"), unread.is_number() ? unread.get<int>() : 0);
    list.push_back(channel);
  }

  return json{{"enabled", true},
              {"canCreate", true},
              {"canManage", true},
              {"canRead", true},
              {"orchestrationEnabled", false},
              {"channelMaxMembers", 12},
              {"defaultAgentId", "demo-agent-default"},
              {"agents", agents},
              {"channels", list},
              {"presence", presence}};
}

void Backend::demoTeamFlush() {
  std::lock_guard<std::mutex> lk(teamMu_);
  const int64_t now = nowMs();
  json pending = jval(demoTeam_, "pending", json::array());
  json keep = json::array();
  json messages = jval(demoTeam_, "messages", json::object());
  for (const auto& item : pending) {
    if (jval(item, "dueAt", 0).get<int64_t>() > now) {
      keep.push_back(item);
      continue;
    }
    const std::string channelId = jstr(item, "channelId");
    json message = jval(item, "message", json::object());
    if (channelId.empty() || !message.is_object()) continue;
    if (!messages.contains(channelId) || !messages[channelId].is_array()) messages[channelId] = json::array();
    messages[channelId].push_back(message);
    auto& watch = teamWatches_[channelId];
    watch.inited = true;
    watch.seq += 1;
    watch.queue.push_back({{"seq", watch.seq}, {"channelId", channelId}, {"message", message}});
  }
  demoTeam_["messages"] = messages;
  demoTeam_["pending"] = keep;
}

json Backend::demoTeamMessages(const std::string& channelId) {
  demoTeamFlush();
  std::lock_guard<std::mutex> lk(teamMu_);
  json messages = jval(demoTeam_, "messages", json::object());
  json list = json::array();
  if (messages.contains(channelId) && messages[channelId].is_array()) {
    list = messages[channelId];
  }
  return json{{"messages", list}, {"hasMore", false}, {"before", ""}};
}

json Backend::demoTeamSend(const std::string& channelId, const std::string& text, const json& mentions,
                           const std::string& replyTo) {
  demoTeamFlush();
  const int64_t now = nowMs();
  const std::string localId = "demo-local-" + std::to_string(now);
  json message = teamLocalMessage(text, mentions, localId);
  if (!replyTo.empty()) {
    // 与真实接口一致：引用目标不存在就不带 replyTo
    bool found = false;
    {
      std::lock_guard<std::mutex> lk(teamMu_);
      json messages = jval(demoTeam_, "messages", json::object());
      if (messages.contains(channelId) && messages[channelId].is_array()) {
        for (const auto& item : messages[channelId]) {
          if (jstr(item, "id") == replyTo) {
            found = true;
            break;
          }
        }
      }
    }
    if (found) message["replyTo"] = replyTo;
  }

  // 频道成员顺序决定谁先接、谁接第二棒；@ 谁就从谁开始
  json channel = json::object();
  json agents = json::array();
  {
    std::lock_guard<std::mutex> lk(teamMu_);
    for (const auto& item : jval(demoTeam_, "channels", json::array())) {
      if (jstr(item, "id") == channelId) channel = item;
    }
    agents = jval(demoTeam_, "agents", json::array());
    json messages = jval(demoTeam_, "messages", json::object());
    if (!messages.contains(channelId) || !messages[channelId].is_array()) messages[channelId] = json::array();
    messages[channelId].push_back(message);
    demoTeam_["messages"] = messages;

    auto& watch = teamWatches_[channelId];
    watch.inited = true;
    watch.seq += 1;
    watch.queue.push_back({{"seq", watch.seq}, {"channelId", channelId}, {"message", message}});
  }

  auto nameOf = [&](const std::string& id) {
    for (const auto& agent : agents) {
      if (jstr(agent, "id") == id) return jstr(agent, "name");
    }
    return std::string("成员");
  };
  auto infoOf = [&](const std::string& id) {
    for (const auto& agent : agents) {
      if (jstr(agent, "id") == id) return agent;
    }
    return json::object();
  };

  json members = jval(channel, "memberAgentIds", json::array());
  auto idOf = [](const json& value) {
    return value.is_string() ? value.get<std::string>() : std::string();
  };
  std::string first;
  for (const auto& id : mentions) {
    const std::string candidate = idOf(id);
    if (!candidate.empty() && !jstr(infoOf(candidate), "id").empty()) {
      first = candidate;
      break;
    }
  }
  if (first.empty() && !members.empty()) first = idOf(members[0]);
  std::string second;
  for (const auto& id : members) {
    const std::string candidate = idOf(id);
    if (!candidate.empty() && candidate != first) {
      second = candidate;
      break;
    }
  }
  if (second.empty()) second = first;

  const std::string firstName = nameOf(first);
  const std::string secondName = nameOf(second);
  json pending = jval(demoTeam_, "pending", json::array());
  pending.push_back({{"dueAt", now + 600},
                     {"channelId", channelId},
                     {"message", json{{"id", "demo-reply-1-" + std::to_string(now)},
                                      {"at", now + 600},
                                      {"from", "agent"},
                                      {"agentId", first},
                                      {"text", "收到，我先看接口契约。\n\n- 入参用 `traceId` 串起来\n- 安全边界交给 @" + secondName + " 先出 stub"}}}});
  pending.push_back({{"dueAt", now + 1100},
                     {"channelId", channelId},
                     {"message", json{{"id", "demo-reply-sys-" + std::to_string(now)},
                                      {"at", now + 1100},
                                      {"from", "system"},
                                      {"kind", "system"},
                                      {"text", firstName + " 把这一棒交给 " + secondName},
                                      {"systemEvent", {{"type", "room-handoff"},
                                                       {"reason", "handoff"},
                                                       {"names", json::array({firstName, secondName})}}}}}});
  pending.push_back({{"dueAt", now + 1700},
                     {"channelId", channelId},
                     {"message", json{{"id", "demo-reply-2-" + std::to_string(now)},
                                      {"at", now + 1700},
                                      {"from", "agent"},
                                      {"agentId", second},
                                      {"text", "stub 已放到 `api/stub/openapi.yaml`，15 分钟后给初版。"}}}});
  {
    std::lock_guard<std::mutex> lk(teamMu_);
    demoTeam_["pending"] = pending;
    // 注意必须直接改 demoTeam_ 里的数组；jval() 返回的是副本，改副本不会落回 fixture
    for (auto& item : demoTeam_["channels"]) {
      if (jstr(item, "id") != channelId) continue;
      item["lastPreview"] = utf8Truncate(text, 240);
      item["lastActiveAt"] = now;
    }
  }
  return message;
}

json Backend::demoTeamCreateChannel(const std::string& name, const json& members,
                                   const std::string& leadId) {
  std::lock_guard<std::mutex> lk(teamMu_);
  const int64_t now = nowMs();
  const std::string id = "demo-c-" + std::to_string(now);
  json channel = {{"id", id},
                  {"name", name},
                  {"memberAgentIds", members},
                  {"leadAgentId", leadId},
                  {"mutedAgentIds", json::array()},
                  {"lastPreview", ""},
                  {"lastActiveAt", now},
                  {"unreadByUser", 0},
                  {"homeCwd", "d:/work/falcon"}};
  demoTeam_["channels"].push_back(channel);
  demoTeam_["messages"][id] = json::array();
  teamWatches_[id] = TeamWatch{};
  return channel;
}

// demo 的成员全量替换：与真实 PATCH /channels/{id} 同样的约束（≥2、≤12、必须在名册里），
// 同时把已移出成员的静音和组长一起清掉，避免 fixture 里留下悬空 id。
json Backend::demoTeamUpdateMembers(const std::string& channelId, const json& members,
                                    std::string& error) {
  std::lock_guard<std::mutex> lk(teamMu_);
  json ids = json::array();
  std::vector<std::string> wanted;
  for (const auto& id : members) {
    if (!id.is_string()) continue;
    const std::string value = id.get<std::string>();
    if (std::find(wanted.begin(), wanted.end(), value) != wanted.end()) continue;
    wanted.push_back(value);
    ids.push_back(value);
  }
  if (wanted.size() < 2) {
    error = "频道至少需要两个智能体";
    return json::object();
  }
  if (wanted.size() > 12) {
    error = "最多 12 个智能体";
    return json::object();
  }
  json roster = jval(demoTeam_, "agents", json::array());
  auto inRoster = [&](const std::string& id) {
    for (const auto& agent : roster) {
      if (jstr(agent, "id") == id) return true;
    }
    return false;
  };
  for (const auto& id : wanted) {
    if (!inRoster(id)) {
      error = "成员必须在智能体名册里";
      return json::object();
    }
  }

  for (auto& item : demoTeam_["channels"]) {
    if (jstr(item, "id") != channelId) continue;
    item["memberAgentIds"] = ids;
    json muted = json::array();
    for (const auto& id : jval(item, "mutedAgentIds", json::array())) {
      if (id.is_string() && std::find(wanted.begin(), wanted.end(), id.get<std::string>()) != wanted.end()) {
        muted.push_back(id);
      }
    }
    item["mutedAgentIds"] = muted;
    const std::string lead = jstr(item, "leadAgentId");
    if (!lead.empty() && std::find(wanted.begin(), wanted.end(), lead) == wanted.end()) {
      item["leadAgentId"] = "";
    }
    json revision = jval(item, "governanceRevision");
    item["governanceRevision"] = (revision.is_number() ? revision.get<int>() : 0) + 1;
    item["lastActiveAt"] = nowMs();
    return trimTeamChannel(item);
  }
  error = "频道不存在";
  return json::object();
}

json Backend::demoTeamUpdateLead(const std::string& channelId, const std::string& leadId,
                                 std::string& error) {
  std::lock_guard<std::mutex> lk(teamMu_);
  for (auto& item : demoTeam_["channels"]) {
    if (jstr(item, "id") != channelId) continue;
    if (!leadId.empty()) {
      bool member = false;
      for (const auto& id : jval(item, "memberAgentIds", json::array())) {
        if (id.is_string() && id.get<std::string>() == leadId) member = true;
      }
      if (!member) {
        error = "组长必须是频道成员";
        return json::object();
      }
    }
    item["leadAgentId"] = leadId;
    json revision = jval(item, "governanceRevision");
    item["governanceRevision"] = (revision.is_number() ? revision.get<int>() : 0) + 1;
    item["lastActiveAt"] = nowMs();
    return trimTeamChannel(item);
  }
  error = "频道不存在";
  return json::object();
}

json Backend::demoTeamAgent(const std::string& id) {
  std::lock_guard<std::mutex> lk(teamMu_);
  for (const auto& agent : jval(demoTeam_, "agents", json::array())) {
    if (jstr(agent, "id") == id) return trimTeamAgentDetail(agent);
  }
  return json::object();
}

json Backend::demoTeamCreateAgent(const std::string& name, const std::string& title,
                                  const std::string& description, const std::string& model,
                                  const std::string& homeCwd, std::string& error) {
  std::lock_guard<std::mutex> lk(teamMu_);
  for (const auto& agent : jval(demoTeam_, "agents", json::array())) {
    if (jstr(agent, "name") == name) {
      error = "已有同名智能体，换个名字";
      return json::object();
    }
  }
  const int64_t now = nowMs();
  json agent = {{"id", "demo-a-" + std::to_string(now)},
                {"name", name},
                {"title", title},
                {"description", description},
                {"model", model.empty() ? "deepseek-v4.1-flash" : model},
                {"avatarVariant", 3},
                {"permissionMode", "fullAccess"},
                {"homeCwd", homeCwd.empty() ? "d:/work/falcon" : homeCwd},
                {"visibility", "visible"},
                {"createdBy", "user"},
                {"lastActiveAt", now}};
  demoTeam_["agents"].push_back(agent);
  return trimTeamAgentDetail(agent);
}

json Backend::demoTeamUpdateAgent(const std::string& id, const json& patch, std::string& error) {
  std::lock_guard<std::mutex> lk(teamMu_);
  for (auto& agent : demoTeam_["agents"]) {
    if (jstr(agent, "id") != id) continue;
    if (patch.contains("name") && patch["name"].is_string()) agent["name"] = patch["name"];
    if (patch.contains("title") && patch["title"].is_string()) {
      const std::string title = patch["title"].get<std::string>();
      if (title.empty()) {
        agent.erase("title");
      } else {
        agent["title"] = title;
      }
    }
    if (patch.contains("description") && patch["description"].is_string()) {
      const std::string description = patch["description"].get<std::string>();
      if (description.empty()) {
        agent.erase("description");
      } else {
        agent["description"] = description;
      }
    }
    if (patch.contains("model") && patch["model"].is_string()) agent["model"] = patch["model"];
    return trimTeamAgentDetail(agent);
  }
  error = "智能体不存在";
  return json::object();
}

void Backend::handleTeamState(const httplib::Request&, httplib::Response& res) {
  json out = demo_ ? demoTeamState() : teamStateFromCli();
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

// 侧栏红点用的轻量轮询：只回 {id, unread}，不重发 agents/channels 全量。
// 每次调用顺带做一次增量扫描（1.2s 内不重复）。
void Backend::handleTeamUnread(const httplib::Request&, httplib::Response& res) {
  if (!demo_ && (!host_ || !host_->ready())) {
    res.set_content(dumpJson(json{{"enabled", false}, {"channels", json::array()}, {"total", 0}}),
                    "application/json; charset=utf-8");
    return;
  }
  refreshTeamUnread();
  std::vector<std::string> ids;
  std::map<std::string, int> cli;
  {
    std::lock_guard<std::mutex> lk(teamUnreadMu_);
    ids = teamChannelIds_;
    cli = teamCliUnread_;
  }
  json channels = json::array();
  int total = 0;
  for (const auto& id : ids) {
    const int unread = teamUnreadCount(id, cli[id]);
    total += unread;
    channels.push_back({{"id", id}, {"unread", unread}});
  }
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(json{{"enabled", true}, {"channels", channels}, {"total", total}}),
                  "application/json; charset=utf-8");
}

// 打开频道 / 滚到底 / 点击「N 条新消息」时上报：本地游标推进到最新，并尽力清零 CLI 的 unreadByUser。
void Backend::handleTeamRead(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (body.is_discarded() || !body.is_object()) body = json::object();
  const std::string channelId = jstr(body, "channelId");
  if (!teamIdOk(channelId)) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "缺少合法的 channelId"}}),
                    "application/json; charset=utf-8");
    return;
  }
  teamMarkRead(channelId);
  res.set_content(dumpJson(json{{"ok", true}, {"unread", 0}}), "application/json; charset=utf-8");
}

// 建频道：CLI 的 POST /channels 只认 {name, memberAgentIds}；组长是建好后单独 PATCH。
// 所以这里先建、再可选设组长，组长失败不回滚频道，只回 warning。
void Backend::handleTeamCreate(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (body.is_discarded() || !body.is_object()) body = json::object();

  auto trim = [](const std::string& value) {
    size_t begin = 0;
    size_t end = value.size();
    while (begin < end && std::isspace(static_cast<unsigned char>(value[begin]))) begin++;
    while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1]))) end--;
    return value.substr(begin, end - begin);
  };

  std::string name = trim(jstr(body, "name"));
  std::string leadId = jstr(body, "leadAgentId");

  json members = json::array();
  std::vector<std::string> seen;
  for (const auto& item : jval(body, "memberAgentIds", json::array())) {
    if (!item.is_string()) continue;
    const std::string id = item.get<std::string>();
    if (!teamIdOk(id)) continue;
    if (std::find(seen.begin(), seen.end(), id) != seen.end()) continue;
    seen.push_back(id);
    members.push_back(id);
  }

  auto fail = [&](const std::string& message, int status = 400) {
    res.status = status;
    res.set_content(dumpJson(json{{"ok", false}, {"error", message}}),
                    "application/json; charset=utf-8");
  };

  if (name.empty()) return fail("请填写频道名");
  if (utf8Truncate(name, 90) != name) return fail("频道名最多 30 个字");

  // 名册与容量都取自同一份 state，避免建频道时连打三次 CLI
  json state = demo_ ? demoTeamState() : teamStateFromCli();
  if (!demo_ && !state.value("enabled", false)) {
    return fail(jstr(state, "reason", "频道服务不可用，暂时不能建频道"));
  }
  const std::string defaultAgentId = jstr(state, "defaultAgentId");
  // 1:1 分身不能进频道，CLI 建频道时会静默剔除；这里提前拦住，避免「选了 2 个却只剩 1 个」
  if (!defaultAgentId.empty() && std::find(seen.begin(), seen.end(), defaultAgentId) != seen.end()) {
    return fail("默认分身不能加入频道，请换一个成员");
  }
  if (members.size() < 2) return fail("频道至少需要两个智能体");

  // 不在名册里的 id 会被 CLI 静默剔除，结果可能是「建好了但只剩 1 人」；
  // 与 /channel/members 用同一句提示，前端和 MCP 工具都走这里
  std::vector<std::string> roster;
  for (const auto& agent : jval(state, "agents", json::array())) roster.push_back(jstr(agent, "id"));
  for (const auto& id : seen) {
    if (std::find(roster.begin(), roster.end(), id) == roster.end()) {
      return fail("成员必须在智能体名册里，请刷新后重试");
    }
  }

  json maxValue = jval(state, "channelMaxMembers");
  const int maxMembers = maxValue.is_number() ? maxValue.get<int>() : 12;
  if (static_cast<int>(members.size()) > maxMembers) {
    return fail("最多 " + std::to_string(maxMembers) + " 个智能体");
  }
  if (!leadId.empty() && std::find(seen.begin(), seen.end(), leadId) == seen.end()) {
    return fail("组长必须是频道成员");
  }

  if (demo_) {
    json channel = demoTeamCreateChannel(name, members, leadId);
    res.set_content(dumpJson(json{{"ok", true}, {"channel", trimTeamChannel(channel)}}),
                    "application/json; charset=utf-8");
    return;
  }

  json resp = agentSend("POST", "/api/v1/agent-home/channels",
                        json{{"name", name}, {"memberAgentIds", members}}, 20);
  json doc = jval(resp, "doc", json::object());
  if (resp.value("status", 0) != 200) {
    const int code = resp.value("status", 0);
    if (code == 0 && resp.value("timeout", false)) {
      // 没有幂等键：超时可能已经建好，让用户先确认再重试，避免同一次操作建出两个频道
      return fail("创建响应超时，频道可能已经建好；请先关闭弹窗看侧栏，确认后再重试");
    }
    return fail(code == 0 ? jstr(resp, "error", "连不上频道服务") : teamErrorText(doc));
  }
  json data = jval(doc, "data", json::object());
  json channel = jval(data, "channel", json::object());
  if (!channel.is_object() || jstr(channel, "id").empty()) channel = jval(doc, "channel", json::object());
  const std::string channelId = jstr(channel, "id");
  if (channelId.empty()) return fail("频道服务没有返回新频道", 502);

  json out = json{{"ok", true}, {"channel", trimTeamChannel(channel)}};
  if (!leadId.empty()) {
    json leadResp = agentSend("PATCH", "/api/v1/agent-home/channels/" + channelId,
                              json{{"leadAgentId", leadId}}, 10);
    if (leadResp.value("status", 0) != 200) {
      out["warning"] = "频道已创建，但设组长失败：" + teamErrorText(jval(leadResp, "doc", json::object()));
    } else {
      // PATCH 的响应可能只回部分字段；组长是刚写进去的，直接补上避免侧栏没有「组长」徽标
      out["channel"]["leadAgentId"] = leadId;
    }
  }
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleTeamMessages(const httplib::Request& req, httplib::Response& res) {
  const std::string channelId = req.get_param_value("channelId");
  if (!teamIdOk(channelId)) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少合法的 channelId"}}), "application/json; charset=utf-8");
    return;
  }
  if (demo_) {
    json page = demoTeamMessages(channelId);
    json list = json::array();
    for (const auto& message : jval(page, "messages", json::array())) list.push_back(trimTeamMessage(message));
    res.set_content(dumpJson(json{{"messages", list}, {"hasMore", false}, {"before", ""}}),
                    "application/json; charset=utf-8");
    return;
  }

  const std::string before = req.get_param_value("before");
  json pageResp;
  json page = teamPageFromCli(channelId, before, "", pageResp);
  if (pageResp.value("status", 0) != 200) {
    json doc = jval(pageResp, "doc", json::object());
    res.status = 502;
    res.set_content(dumpJson(json{{"error", teamErrorText(doc)}}), "application/json; charset=utf-8");
    return;
  }

  json list = json::array();
  for (const auto& message : jval(page, "messages", json::array())) list.push_back(trimTeamMessage(message));
  // 打开频道（无 before）时把增量游标对齐到最新一条；否则长轮询会把历史再推一遍
  if (before.empty()) teamSeedCursor(channelId, jstr(page, "after"), true);

  json out = {{"messages", list},
              {"hasMore", jval(page, "hasMore", false)},
              {"before", jstr(page, "before")}};
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleTeamSend(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (body.is_discarded() || !body.is_object()) body = json::object();
  const std::string channelId = jstr(body, "channelId");
  const std::string text = jstr(body, "text");
  if (!teamIdOk(channelId) || text.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "缺少 channelId 或 text"}}),
                    "application/json; charset=utf-8");
    return;
  }
  json mentions = jval(body, "mentionAgentIds", json::array());
  if (!mentions.is_array()) mentions = json::array();
  json clean = json::array();
  for (const auto& id : mentions) {
    if (id.is_string() && teamIdOk(id.get<std::string>())) clean.push_back(id);
  }
  // 引用：CLI 的 replyTo 就是原消息 id（也接受唯一前缀，壳只传完整 id）
  const std::string replyToRaw = jstr(body, "replyTo");
  const std::string replyTo = teamIdOk(replyToRaw) ? replyToRaw : "";

  if (demo_) {
    json message = demoTeamSend(channelId, text, clean, replyTo);
    res.set_content(dumpJson(json{{"ok", true}, {"message", trimTeamMessage(message)}}),
                    "application/json; charset=utf-8");
    return;
  }

  // 实测写操作无幂等键：超时按「已发送、回复稍后到」处理，绝不重试（会重复发消息）
  json reqBody = {{"text", text}, {"mentionAgentIds", clean}};
  if (!replyTo.empty()) reqBody["replyTo"] = replyTo;
  json resp = agentSend("POST", "/api/v1/agent-home/channels/" + channelId + "/messages",
                        reqBody, 15);
  const int status = resp.value("status", 0);
  const int64_t now = nowMs();
  if (status == 0) {
    // 只有「读超时」才按已发送处理；连接失败说明消息大概率没出去，让前端保留文字
    if (!resp.value("timeout", false)) {
      res.status = 400;
      res.set_content(dumpJson(json{{"ok", false},
                                    {"error", jstr(resp, "error", "连不上频道服务")}}),
                      "application/json; charset=utf-8");
      return;
    }
    json local = teamLocalMessage(text, clean, "local-" + std::to_string(now));
    if (!replyTo.empty()) local["replyTo"] = replyTo;
    res.set_content(dumpJson(json{{"ok", true},
                                  {"pending", true},
                                  {"message", local},
                                  {"warning", "发送响应超时，消息可能已送达；本轮回复稍后到"}}),
                    "application/json; charset=utf-8");
    return;
  }
  json doc = jval(resp, "doc", json::object());
  if (status != 200) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", teamErrorText(doc)}}),
                    "application/json; charset=utf-8");
    return;
  }
  json data = jval(doc, "data", json::object());
  json message = jval(data, "message", json::object());
  if (!message.is_object() || jstr(message, "id").empty()) message = jval(doc, "message", json::object());
  if (!message.is_object() || jstr(message, "id").empty()) {
    message = teamLocalMessage(text, clean, "local-" + std::to_string(now));
    if (!replyTo.empty()) message["replyTo"] = replyTo;
  }
  json out = {{"ok", true}, {"message", trimTeamMessage(message)}};
  // 原消息不在本频道时 CLI 会丢掉 replyTo 但照常落消息；如实告诉用户，别假装引用成功
  if (data.value("replyToDropped", false) || doc.value("replyToDropped", false)) {
    out["warning"] = "原消息不在本频道，已按普通消息发送";
  }
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleTeamEvents(const httplib::Request& req, httplib::Response& res) {
  const std::string channelId = req.get_param_value("channelId");
  if (!teamIdOk(channelId)) {
    res.status = 400;
    res.set_content(dumpJson(json{{"events", json::array()}, {"lastSeq", 0}, {"error", "缺少合法的 channelId"}}),
                    "application/json; charset=utf-8");
    return;
  }
  int64_t from = 0;
  int waitMs = 15000;
  try {
    if (req.has_param("from")) from = std::stoll(req.get_param_value("from"));
    if (req.has_param("wait")) waitMs = std::stoi(req.get_param_value("wait"));
  } catch (...) {
  }
  if (waitMs < 0) waitMs = 0;
  if (waitMs > 25000) waitMs = 25000;
  const int64_t deadline = nowMs() + waitMs;

  if (!demo_ && (!host_ || !host_->ready())) {
    res.set_content(dumpJson(json{{"events", json::array()},
                                  {"lastSeq", from},
                                  {"error", "CLI 未就绪，频道更新已暂停"}}),
                    "application/json; charset=utf-8");
    return;
  }

  // 真实模式：若无游标，先对齐到最新一页（前端总是先拉 messages，这里只兜底）
  if (!demo_) {
    bool inited = false;
    {
      std::lock_guard<std::mutex> lk(teamMu_);
      inited = teamWatches_[channelId].inited;
    }
    if (!inited) {
      json pageResp;
      json page = teamPageFromCli(channelId, "", "", pageResp);
      if (pageResp.value("status", 0) == 200) teamSeedCursor(channelId, jstr(page, "after"), true);
    }
    // 游标没对齐就不要进长轮询：立刻返回错误让前端退避，避免 700ms 空转
    {
      std::lock_guard<std::mutex> lk(teamMu_);
      inited = teamWatches_[channelId].inited;
    }
    if (!inited) {
      res.set_content(dumpJson(json{{"events", json::array()},
                                    {"lastSeq", from},
                                    {"error", "频道游标未就绪，请重新打开频道"}}),
                      "application/json; charset=utf-8");
      return;
    }
  }

  json events = json::array();
  int64_t lastSeq = from;
  std::string error;
  bool first = true;
  while (true) {
    if (demo_) demoTeamFlush();
    {
      std::lock_guard<std::mutex> lk(teamMu_);
      auto& watch = teamWatches_[channelId];
      for (const auto& event : watch.queue) {
        if (jval(event, "seq", 0).get<int64_t>() > from) {
          // 显式标成 channel 事件、sessionId 留空：即使以后混进 /api/events，
          // 也不会被前端当成 ACP 会话事件（chat.ts 会丢弃 sessionId 不匹配的事件）
          json item = event;
          item["type"] = "channel";
          item["sessionId"] = "";
          events.push_back(item);
        }
      }
      lastSeq = watch.seq;
    }
    if (!events.empty()) break;
    if (nowMs() >= deadline) break;

    if (!demo_ && !first) {
      std::string after;
      bool inited = false;
      {
        std::lock_guard<std::mutex> lk(teamMu_);
        inited = teamWatches_[channelId].inited;
        after = teamWatches_[channelId].after;
      }
      // 没对齐游标时不要拉页：否则每次轮询都会把整页历史当增量推一遍
      if (!inited) break;
      json pageResp;
      json page = teamPageFromCli(channelId, "", after, pageResp);
      if (pageResp.value("status", 0) != 200) {
        error = teamErrorText(jval(pageResp, "doc", json::object()));
        break;
      }
      json fresh = jval(page, "messages", json::array());
      {
        std::lock_guard<std::mutex> lk(teamMu_);
        auto& watch = teamWatches_[channelId];
        for (const auto& message : fresh) {
          const std::string id = jstr(message, "id");
          bool seen = false;
          for (const auto& queued : watch.queue) {
            if (jstr(jval(queued, "message", json::object()), "id") == id) {
              seen = true;
              break;
            }
          }
          if (seen) continue;
          watch.seq += 1;
          watch.queue.push_back({{"seq", watch.seq}, {"channelId", channelId}, {"message", message}});
        }
        watch.after = jstr(page, "after", watch.after);
        // 队列只保留最近 200 条，避免一次打开长频道把内存吃满
        while (watch.queue.size() > 200) watch.queue.pop_front();
      }
    }
    first = false;
    std::this_thread::sleep_for(std::chrono::milliseconds(700));
  }

  json out = {{"events", events}, {"lastSeq", lastSeq}};
  if (!error.empty()) out["error"] = error;
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleTeamMember(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (body.is_discarded() || !body.is_object()) body = json::object();
  const std::string channelId = jstr(body, "channelId");
  const std::string agentId = jstr(body, "agentId");
  const bool muted = body.value("muted", false);
  if (!teamIdOk(channelId) || !teamIdOk(agentId)) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "缺少合法的 channelId / agentId"}}),
                    "application/json; charset=utf-8");
    return;
  }

  if (demo_) {
    json channel = json::object();
    {
      std::lock_guard<std::mutex> lk(teamMu_);
      for (auto& item : demoTeam_["channels"]) {
        if (jstr(item, "id") != channelId) continue;
        json next = json::array();
        bool found = false;
        for (const auto& id : jval(item, "mutedAgentIds", json::array())) {
          const bool same = id.is_string() && id.get<std::string>() == agentId;
          if (same) {
            found = true;
            if (muted) next.push_back(id);
          } else {
            next.push_back(id);
          }
        }
        if (!found && muted) next.push_back(agentId);
        item["mutedAgentIds"] = next;
        channel = trimTeamChannel(item);
      }
    }
    if (channel.empty()) {
      res.status = 404;
      res.set_content(dumpJson(json{{"ok", false}, {"error", "频道不存在"}}), "application/json; charset=utf-8");
      return;
    }
    res.set_content(dumpJson(json{{"ok", true}, {"channel", channel}}), "application/json; charset=utf-8");
    return;
  }

  // CLI 没有单独静音接口：PATCH 频道时带完整 mutedAgentIds 列表
  json state = teamStateFromCli();
  if (!state.value("enabled", false)) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false},
                                  {"error", jstr(state, "reason", "CLI 未就绪，暂时不能修改静音")}}),
                    "application/json; charset=utf-8");
    return;
  }
  json target = json::object();
  for (const auto& channel : jval(state, "channels", json::array())) {
    if (jstr(channel, "id") == channelId) target = channel;
  }
  if (target.empty()) {
    res.status = 404;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "频道不存在"}}), "application/json; charset=utf-8");
    return;
  }
  json next = json::array();
  bool found = false;
  for (const auto& id : jval(target, "mutedAgentIds", json::array())) {
    const bool same = id.is_string() && id.get<std::string>() == agentId;
    if (same) {
      found = true;
      if (muted) next.push_back(id);
    } else {
      next.push_back(id);
    }
  }
  if (!found && muted) next.push_back(agentId);

  json resp = agentSend("PATCH", "/api/v1/agent-home/channels/" + channelId,
                        json{{"mutedAgentIds", next}}, 10);
  json doc = jval(resp, "doc", json::object());
  if (resp.value("status", 0) != 200) {
    const int code = resp.value("status", 0);
    const std::string error = code == 0 ? jstr(resp, "error", "连不上频道服务") : teamErrorText(doc);
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", error}}),
                    "application/json; charset=utf-8");
    return;
  }
  json data = jval(doc, "data", json::object());
  json channel = jval(data, "channel", json::object());
  if (!channel.is_object() || jstr(channel, "id").empty()) channel = jval(doc, "channel", json::object());
  if (!channel.is_object() || jstr(channel, "id").empty()) {
    json merged = target;
    merged["mutedAgentIds"] = next;
    channel = merged;
  }
  res.set_content(dumpJson(json{{"ok", true}, {"channel", trimTeamChannel(channel)}}),
                  "application/json; charset=utf-8");
}

void Backend::handleTeamRestart(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (body.is_discarded() || !body.is_object()) body = json::object();
  const std::string agentId = jstr(body, "agentId");
  if (!teamIdOk(agentId)) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "缺少合法的 agentId"}}),
                    "application/json; charset=utf-8");
    return;
  }
  if (demo_) {
    res.set_content(dumpJson(json{{"ok", true}}), "application/json; charset=utf-8");
    return;
  }
  json resp = agentSend("POST", "/api/v1/agent-home/agents/" + agentId + "/restart", json(), 20);
  json doc = jval(resp, "doc", json::object());
  if (resp.value("status", 0) != 200) {
    const int code = resp.value("status", 0);
    const std::string error = code == 0 ? jstr(resp, "error", "连不上频道服务") : teamErrorText(doc);
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", error}}),
                    "application/json; charset=utf-8");
    return;
  }
  res.set_content(dumpJson(json{{"ok", true}}), "application/json; charset=utf-8");
}

// 成员增删走「全量替换」：CLI 的 PATCH 也是整表覆盖，前端只需要提交最终成员列表。
void Backend::handleTeamMembers(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (body.is_discarded() || !body.is_object()) body = json::object();
  const std::string channelId = jstr(body, "channelId");

  auto fail = [&](const std::string& message, int status = 400) {
    res.status = status;
    res.set_content(dumpJson(json{{"ok", false}, {"error", message}}),
                    "application/json; charset=utf-8");
  };

  if (!teamIdOk(channelId)) return fail("缺少合法的 channelId");

  json members = json::array();
  std::vector<std::string> seen;
  for (const auto& item : jval(body, "memberAgentIds", json::array())) {
    if (!item.is_string()) continue;
    const std::string id = item.get<std::string>();
    if (!teamIdOk(id)) continue;
    if (std::find(seen.begin(), seen.end(), id) != seen.end()) continue;
    seen.push_back(id);
    members.push_back(id);
  }

  json state = demo_ ? demoTeamState() : teamStateFromCli();
  if (!demo_ && !state.value("enabled", false)) {
    return fail(jstr(state, "reason", "频道服务不可用，暂时不能改成员"));
  }

  json target = json::object();
  for (const auto& channel : jval(state, "channels", json::array())) {
    if (jstr(channel, "id") == channelId) target = channel;
  }
  if (target.empty()) return fail("频道不存在或已被删除", 404);

  const std::string defaultAgentId = jstr(state, "defaultAgentId");
  if (!defaultAgentId.empty() &&
      std::find(seen.begin(), seen.end(), defaultAgentId) != seen.end()) {
    return fail("默认分身不能加入频道，请换一个成员");
  }

  std::vector<std::string> roster;
  for (const auto& agent : jval(state, "agents", json::array())) roster.push_back(jstr(agent, "id"));
  for (const auto& id : seen) {
    if (std::find(roster.begin(), roster.end(), id) == roster.end()) {
      return fail("成员必须在智能体名册里，请刷新后重试");
    }
  }
  if (members.size() < 2) return fail("频道至少需要两个智能体");
  json maxValue = jval(state, "channelMaxMembers");
  const int maxMembers = maxValue.is_number() ? maxValue.get<int>() : 12;
  if (static_cast<int>(members.size()) > maxMembers) {
    return fail("最多 " + std::to_string(maxMembers) + " 个智能体");
  }

  if (demo_) {
    std::string error;
    json channel = demoTeamUpdateMembers(channelId, members, error);
    if (channel.empty()) return fail(error.empty() ? "修改成员失败" : error);
    res.set_content(dumpJson(json{{"ok", true}, {"channel", channel}}),
                    "application/json; charset=utf-8");
    return;
  }

  json patch = {{"memberAgentIds", members}};
  json expected = jval(body, "expectedRevision");
  if (expected.is_number_integer()) patch["expectedRevision"] = expected;

  // 写操作 15s 超时、不重试：成员替换没有幂等键，重试可能把别人的改动覆盖回去
  json resp = agentSend("PATCH", "/api/v1/agent-home/channels/" + channelId, patch, 15);
  const int status = resp.value("status", 0);
  json doc = jval(resp, "doc", json::object());
  if (status != 200) {
    if (status == 0) {
      return fail(resp.value("timeout", false)
                      ? "修改成员超时，结果未知；请刷新频道确认，不要直接重试"
                      : jstr(resp, "error", "连不上频道服务"));
    }
    return fail(teamWriteErrorText(doc, "修改成员失败"),
                status == 404 ? 404 : status == 409 ? 409 : 400);
  }

  json data = jval(doc, "data", json::object());
  json channel = jval(data, "channel", json::object());
  if (!channel.is_object() || jstr(channel, "id").empty()) channel = jval(doc, "channel", json::object());
  if (!channel.is_object() || jstr(channel, "id").empty()) {
    // PATCH 只回了部分字段时，用本地目标拼回完整频道；成员是刚写的，直接覆盖
    channel = target;
    channel["memberAgentIds"] = members;
    if (!jstr(channel, "leadAgentId").empty() &&
        std::find(seen.begin(), seen.end(), jstr(channel, "leadAgentId")) == seen.end()) {
      channel["leadAgentId"] = "";
    }
  }
  res.set_content(dumpJson(json{{"ok", true}, {"channel", trimTeamChannel(channel)}}),
                  "application/json; charset=utf-8");
}

// 设/撤组长：CLI 用同一条 PATCH，leadAgentId 传 null 表示交回用户编排。
void Backend::handleTeamLead(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (body.is_discarded() || !body.is_object()) body = json::object();
  const std::string channelId = jstr(body, "channelId");
  std::string leadId;
  if (body.contains("leadAgentId") && body["leadAgentId"].is_string()) {
    leadId = body["leadAgentId"].get<std::string>();
  }

  auto fail = [&](const std::string& message, int status = 400) {
    res.status = status;
    res.set_content(dumpJson(json{{"ok", false}, {"error", message}}),
                    "application/json; charset=utf-8");
  };

  if (!teamIdOk(channelId)) return fail("缺少合法的 channelId");
  if (!leadId.empty() && !teamIdOk(leadId)) return fail("leadAgentId 不合法");

  json state = demo_ ? demoTeamState() : teamStateFromCli();
  if (!demo_ && !state.value("enabled", false)) {
    return fail(jstr(state, "reason", "频道服务不可用，暂时不能改组长"));
  }
  json target = json::object();
  for (const auto& channel : jval(state, "channels", json::array())) {
    if (jstr(channel, "id") == channelId) target = channel;
  }
  if (target.empty()) return fail("频道不存在或已被删除", 404);
  if (!leadId.empty()) {
    bool member = false;
    for (const auto& id : jval(target, "memberAgentIds", json::array())) {
      if (id.is_string() && id.get<std::string>() == leadId) member = true;
    }
    if (!member) return fail("组长必须是频道成员");
  }

  if (demo_) {
    std::string error;
    json channel = demoTeamUpdateLead(channelId, leadId, error);
    if (channel.empty()) return fail(error.empty() ? "修改组长失败" : error);
    res.set_content(dumpJson(json{{"ok", true}, {"channel", channel}}),
                    "application/json; charset=utf-8");
    return;
  }

  json patch = json::object();
  if (leadId.empty()) {
    patch["leadAgentId"] = nullptr;
  } else {
    patch["leadAgentId"] = leadId;
  }
  json expected = jval(body, "expectedRevision");
  if (expected.is_number_integer()) patch["expectedRevision"] = expected;

  json resp = agentSend("PATCH", "/api/v1/agent-home/channels/" + channelId, patch, 15);
  const int status = resp.value("status", 0);
  json doc = jval(resp, "doc", json::object());
  if (status != 200) {
    if (status == 0) {
      return fail(resp.value("timeout", false)
                      ? "修改组长超时，结果未知；请刷新频道确认，不要直接重试"
                      : jstr(resp, "error", "连不上频道服务"));
    }
    return fail(teamWriteErrorText(doc, "修改组长失败"),
                status == 404 ? 404 : status == 409 ? 409 : 400);
  }

  json data = jval(doc, "data", json::object());
  json channel = jval(data, "channel", json::object());
  if (!channel.is_object() || jstr(channel, "id").empty()) channel = jval(doc, "channel", json::object());
  if (!channel.is_object() || jstr(channel, "id").empty()) {
    channel = target;
    channel["leadAgentId"] = leadId;
  }
  res.set_content(dumpJson(json{{"ok", true}, {"channel", trimTeamChannel(channel)}}),
                  "application/json; charset=utf-8");
}

// 单个 bot 详情。CLI 没有 GET /agents/{id}，只能读整份目录后挑选；description 只在这里返回。
void Backend::handleTeamAgentGet(const httplib::Request& req, httplib::Response& res) {
  const std::string id = req.get_param_value("id");
  auto fail = [&](const std::string& message, int status = 400) {
    res.status = status;
    res.set_content(dumpJson(json{{"ok", false}, {"error", message}}),
                    "application/json; charset=utf-8");
  };
  if (!teamIdOk(id)) return fail("缺少合法的 id");

  if (demo_) {
    json agent = demoTeamAgent(id);
    if (agent.empty()) return fail("智能体不存在或已被删除", 404);
    res.set_content(dumpJson(json{{"ok", true}, {"agent", agent}}),
                    "application/json; charset=utf-8");
    return;
  }

  json data = agentGet("/api/v1/agent-home");
  if (!data.is_object() || data.empty()) return fail("读不到智能体名册，请确认 CLI 已就绪", 502);
  const std::string defaultAgentId = jstr(data, "defaultAgentId");
  for (const auto& agent : jval(data, "agents", json::array())) {
    if (jstr(agent, "id") != id) continue;
    if (!defaultAgentId.empty() && id == defaultAgentId) {
      return fail("默认分身没有可编辑的人设");
    }
    res.set_content(dumpJson(json{{"ok", true}, {"agent", trimTeamAgentDetail(agent)}}),
                    "application/json; charset=utf-8");
    return;
  }
  fail("智能体不存在或已被删除", 404);
}

// 新建智能体：CLI 的 POST /agents 支持 name/title/description/model/homeCwd，
// 不传 permissionMode 时沿用服务端默认，避免壳里伪造一个用户没选的权限。
void Backend::handleTeamAgentCreate(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (body.is_discarded() || !body.is_object()) body = json::object();

  auto trim = [](const std::string& value) {
    size_t begin = 0;
    size_t end = value.size();
    while (begin < end && std::isspace(static_cast<unsigned char>(value[begin]))) begin++;
    while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1]))) end--;
    return value.substr(begin, end - begin);
  };
  auto fail = [&](const std::string& message, int status = 400) {
    res.status = status;
    res.set_content(dumpJson(json{{"ok", false}, {"error", message}}),
                    "application/json; charset=utf-8");
  };

  const std::string name = trim(jstr(body, "name"));
  const std::string title = trim(jstr(body, "title"));
  const std::string description = trim(jstr(body, "description"));
  const std::string model = trim(jstr(body, "model"));
  const std::string homeCwd = trim(jstr(body, "homeCwd"));

  if (name.empty()) return fail("请填写智能体名字");
  if (utf8Truncate(name, 180) != name) return fail("名字最多 60 个字");
  if (utf8Truncate(title, 180) != title) return fail("角色最多 60 个字");
  if (utf8Truncate(description, 6000) != description) return fail("人设最多 2000 个字");

  json state = demo_ ? demoTeamState() : teamStateFromCli();
  if (!demo_ && !state.value("enabled", false)) {
    return fail(jstr(state, "reason", "频道服务不可用，暂时不能新建智能体"));
  }
  for (const auto& agent : jval(state, "agents", json::array())) {
    if (trim(jstr(agent, "name")) == name) return fail("已有同名智能体，换个名字");
  }

  if (demo_) {
    std::string error;
    json agent = demoTeamCreateAgent(name, title, description, model, homeCwd, error);
    if (agent.empty()) return fail(error.empty() ? "新建智能体失败" : error);
    res.set_content(dumpJson(json{{"ok", true}, {"agent", agent}}),
                    "application/json; charset=utf-8");
    return;
  }

  json payload = {{"name", name}};
  if (!title.empty()) payload["title"] = title;
  if (!description.empty()) payload["description"] = description;
  if (!model.empty()) payload["model"] = model;
  if (!homeCwd.empty()) payload["homeCwd"] = homeCwd;

  json resp = agentSend("POST", "/api/v1/agent-home/agents", payload, 15);
  const int status = resp.value("status", 0);
  json doc = jval(resp, "doc", json::object());
  if (status != 200) {
    if (status == 0) {
      return fail(resp.value("timeout", false)
                      ? "新建智能体超时，可能已经创建；请刷新名册确认，不要直接重试"
                      : jstr(resp, "error", "连不上频道服务"));
    }
    return fail(teamWriteErrorText(doc, "新建智能体失败"));
  }
  json data = jval(doc, "data", json::object());
  json agent = jval(data, "agent", json::object());
  if (!agent.is_object() || jstr(agent, "id").empty()) agent = jval(doc, "agent", json::object());
  if (!agent.is_object() || jstr(agent, "id").empty()) {
    return fail("智能体服务没有返回新 bot，请刷新名册确认", 502);
  }
  res.set_content(dumpJson(json{{"ok", true}, {"agent", trimTeamAgentDetail(agent)}}),
                  "application/json; charset=utf-8");
}

// 改人设/内部提示词：只提交用户改过的字段；description 就是该 bot 的系统提示词素材。
void Backend::handleTeamAgentUpdate(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (body.is_discarded() || !body.is_object()) body = json::object();
  const std::string id = jstr(body, "agentId").empty() ? jstr(body, "id") : jstr(body, "agentId");

  auto trim = [](const std::string& value) {
    size_t begin = 0;
    size_t end = value.size();
    while (begin < end && std::isspace(static_cast<unsigned char>(value[begin]))) begin++;
    while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1]))) end--;
    return value.substr(begin, end - begin);
  };
  auto fail = [&](const std::string& message, int status = 400) {
    res.status = status;
    res.set_content(dumpJson(json{{"ok", false}, {"error", message}}),
                    "application/json; charset=utf-8");
  };

  if (!teamIdOk(id)) return fail("缺少合法的 agentId");
  if (!body.contains("name") && !body.contains("title") && !body.contains("description")) {
    return fail("没有要保存的字段");
  }

  json patch = json::object();
  if (body.contains("name")) {
    const std::string name = trim(jstr(body, "name"));
    if (name.empty()) return fail("名字不能为空");
    if (utf8Truncate(name, 180) != name) return fail("名字最多 60 个字");
    patch["name"] = name;
  }
  if (body.contains("title")) {
    const std::string title = trim(jstr(body, "title"));
    if (utf8Truncate(title, 180) != title) return fail("角色最多 60 个字");
    patch["title"] = title;
  }
  if (body.contains("description")) {
    // 人设允许清空：服务端把空字符串当成「删除该字段」
    const std::string description = trim(jstr(body, "description"));
    if (utf8Truncate(description, 6000) != description) return fail("人设最多 2000 个字");
    patch["description"] = description;
  }

  json state = demo_ ? demoTeamState() : teamStateFromCli();
  if (!demo_ && !state.value("enabled", false)) {
    return fail(jstr(state, "reason", "频道服务不可用，暂时不能编辑智能体"));
  }
  if (patch.contains("name")) {
    const std::string name = patch["name"].get<std::string>();
    // 前端每次都会带 name；只有真的改名时才做重名检查，避免历史上同名的 bot 连人设都改不了
    bool renamed = true;
    for (const auto& agent : jval(state, "agents", json::array())) {
      if (jstr(agent, "id") == id && trim(jstr(agent, "name")) == name) renamed = false;
    }
    if (renamed) {
      for (const auto& agent : jval(state, "agents", json::array())) {
        if (jstr(agent, "id") == id) continue;
        if (trim(jstr(agent, "name")) == name) return fail("已有同名智能体，换个名字");
      }
    }
  }

  if (demo_) {
    std::string error;
    json agent = demoTeamUpdateAgent(id, patch, error);
    if (agent.empty()) return fail(error.empty() ? "保存失败" : error);
    res.set_content(dumpJson(json{{"ok", true}, {"agent", agent}}),
                    "application/json; charset=utf-8");
    return;
  }

  json resp = agentSend("PATCH", "/api/v1/agent-home/agents/" + id, patch, 15);
  const int status = resp.value("status", 0);
  json doc = jval(resp, "doc", json::object());
  if (status != 200) {
    if (status == 0) {
      return fail(resp.value("timeout", false)
                      ? "保存超时，结果未知；请刷新详情确认，不要直接重试"
                      : jstr(resp, "error", "连不上频道服务"));
    }
    return fail(teamWriteErrorText(doc, "保存失败"), status == 404 ? 404 : 400);
  }
  json data = jval(doc, "data", json::object());
  json agent = jval(data, "agent", json::object());
  if (!agent.is_object() || jstr(agent, "id").empty()) agent = jval(doc, "agent", json::object());
  json out = {{"ok", true}};
  if (agent.is_object() && !agent.empty()) {
    out["agent"] = trimTeamAgentDetail(agent);
  } else {
    // 响应缺字段时用本地值回填，至少让前端能把改动落到列表上
    json merged = json{{"id", id}};
    for (const auto& entry : patch.items()) merged[entry.key()] = entry.value();
    out["agent"] = merged;
  }
  json channels = jval(data, "channels", json::array());
  if (channels.is_array()) {
    json trimmed = json::array();
    for (const auto& channel : channels) {
      if (channel.is_object()) trimmed.push_back(trimTeamChannel(channel));
    }
    out["channels"] = trimmed;
  }
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

// /api/v1/stats 会扫全部历史会话，实测 0.9–1.2s；前端每轮对话要读好几次用量。
// 这里缓存 60s，过期后返回旧值并在后台刷新，避免把 httplib 的线程池占满。
json Backend::cliStats() {
  const int64_t now = nowMs();
  bool haveCache = false;
  {
    std::lock_guard<std::mutex> lk(remoteMu_);
    haveCache = cliStatsCache_.is_object() && !cliStatsCache_.empty();
    if (haveCache && now - cliStatsAt_ < 60000) return cliStatsCache_;
  }
  if (!cliStatsBusy_.exchange(true)) {
    if (!haveCache) {
      // 首次没有旧值，只能同步等一次
      json fresh = agentGet("/api/v1/stats");
      std::lock_guard<std::mutex> lk(remoteMu_);
      if (fresh.is_object() && !fresh.empty()) {
        cliStatsCache_ = fresh;
        cliStatsAt_ = nowMs();
      }
      cliStatsBusy_ = false;
      return cliStatsCache_;
    }
    std::thread([this] {
      json fresh = agentGet("/api/v1/stats");
      {
        std::lock_guard<std::mutex> lk(remoteMu_);
        if (fresh.is_object() && !fresh.empty()) {
          cliStatsCache_ = fresh;
          cliStatsAt_ = nowMs();
        }
      }
      cliStatsBusy_ = false;
    }).detach();
  }
  std::lock_guard<std::mutex> lk(remoteMu_);
  return cliStatsCache_;
}

// /api/v1/sessions/workspaces 同样是现算的，工作空间面板打开一次要等半秒
json Backend::agentRecents() {
  const int64_t now = nowMs();
  bool haveCache = false;
  {
    std::lock_guard<std::mutex> lk(remoteMu_);
    haveCache = !recentsCache_.empty();
    if (haveCache && now - recentsAt_ < 60000) return recentsCache_;
  }
  if (!recentsBusy_.exchange(true)) {
    if (!haveCache) {
      json fresh = agentGet("/api/v1/sessions/workspaces");
      std::lock_guard<std::mutex> lk(remoteMu_);
      if (fresh.is_object() && !fresh.empty()) {
        recentsCache_ = fresh;
        recentsAt_ = nowMs();
      }
      recentsBusy_ = false;
      return recentsCache_;
    }
    std::thread([this] {
      json fresh = agentGet("/api/v1/sessions/workspaces");
      {
        std::lock_guard<std::mutex> lk(remoteMu_);
        if (fresh.is_object() && !fresh.empty()) {
          recentsCache_ = fresh;
          recentsAt_ = nowMs();
        }
      }
      recentsBusy_ = false;
    }).detach();
  }
  std::lock_guard<std::mutex> lk(remoteMu_);
  return recentsCache_;
}

json Backend::scannedWorkspaces() {
  const int64_t now = nowMs();
  {
    std::lock_guard<std::mutex> lk(wsCacheMu_);
    if (wsCache_.is_array() && now - wsCacheAt_ < 60000) return wsCache_;
  }

  const std::string home = homePath();
  if (home.empty()) return json::array();

  std::map<std::string, std::string> displayNames;
  json namesDoc = readJsonFile(joinPathSafe(home, ".workbuddy\\workspace-display-names.json"));
  json names = jval(namesDoc, "workspaces", json::object());
  if (names.is_object()) {
    for (auto it = names.begin(); it != names.end(); ++it) {
      std::string path = jstr(it.value(), "path", it.key());
      std::string name = jstr(it.value(), "displayName");
      if (!path.empty() && !name.empty()) displayNames[pathKey(path)] = name;
    }
  }

  json out = json::array();
  for (const auto& w : scanProjectRoot(joinPathSafe(home, ".codebuddy\\projects"), "codebuddy", displayNames)) {
    out.push_back(w);
  }
  for (const auto& w : scanProjectRoot(joinPathSafe(home, ".workbuddy\\projects"), "workbuddy", displayNames)) {
    out.push_back(w);
  }

  std::lock_guard<std::mutex> lk(wsCacheMu_);
  wsCache_ = out;
  wsCacheAt_ = now;
  return out;
}

std::string Backend::runOrganizerPrompt(const std::string& prompt, std::string& err) {
  if (demo_) {
    err = "演示模式没有模型，不能做 AI 整理";
    return "";
  }
  std::lock_guard<std::mutex> run(aiRunMu_);
  if (!ensureAgent(err)) return "";

  std::string sid;
  try {
    json info = client_->newSessionInfo(currentCwd());
    sid = jstr(info, "sessionId");
  } catch (const std::exception& e) {
    err = e.what();
    return "";
  }
  if (sid.empty()) {
    err = "创建临时整理会话失败";
    return "";
  }
  {
    std::lock_guard<std::mutex> lk(aiTextMu_);
    aiText_[sid] = "";
  }

  bool ok = true;
  try {
    std::string model = selectedModel();
    if (!model.empty()) client_->setConfigOption(sid, "model", model);
    client_->prompt(sid, prompt, json::array(), 180);
  } catch (const std::exception& e) {
    err = e.what();
    ok = false;
  }

  std::string text;
  {
    std::lock_guard<std::mutex> lk(aiTextMu_);
    auto it = aiText_.find(sid);
    if (it != aiText_.end()) text = it->second;
    aiText_.erase(sid);
  }
  // 当前 CLI 不认 session/delete / session/close（都返回 Method not found），
  // 而这个临时会话本来就不进 store、不出现在列表里，留着不影响使用，
  // 所以不再每次整理都去试一次（还会白等一轮 rpc 超时）。
  if (!ok) return "";
  if (text.empty()) {
    err = "模型没有返回内容";
    return "";
  }
  return text;
}

json Backend::workspaceList() {
  const std::string cw = currentCwd();
  json list = json::array();
  std::set<std::string> seen;
  auto add = [&](const std::string& path, const std::string& label, const std::string& source) {
    if (path.empty() || !isDirectoryPath(path)) return;
    std::string key = pathKey(path);
    if (!seen.insert(key).second) return;
    list.push_back({{"path", path},
                    {"label", label.empty() ? leafName(path) : label},
                    {"source", source},
                    {"current", samePath(path, cw)}});
  };

  add(cw, leafName(cw), "current");

  // 自建工作空间优先：带完整文件夹列表，界面上可以编辑
  const std::string activeId = jstr(activeWorkspaceInfo(), "id");
  {
    json doc = loadWorkspacesDoc();
    for (const auto& w : jval(doc, "workspaces", json::array())) {
      auto folders = foldersOf(w);
      if (folders.empty() || !isDirectoryPath(folders[0])) continue;
      std::string key = pathKey(folders[0]);
      if (!seen.insert(key).second) continue;
      std::string id = jstr(w, "id");
      list.push_back({{"id", id},
                      {"path", folders[0]},
                      {"label", jstr(w, "name", leafName(folders[0]))},
                      {"source", "custom"},
                      {"folders", folders},
                      {"active", !id.empty() && id == activeId},
                      {"current", samePath(folders[0], cw)}});
    }
  }
  if (!demo_) {
    json ws = agentRecents();
    for (const auto& w : jval(ws, "workspaces", json::array())) {
      add(jstr(w, "path"), jstr(w, "label"), "recent");
    }
  }
  for (const auto& w : scannedWorkspaces()) {
    add(jstr(w, "path"), jstr(w, "label"), jstr(w, "source"));
  }
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    auto arrIt = store_.find("sessions");
    if (arrIt != store_.end() && arrIt->is_array()) {
      for (const auto& s : *arrIt) {
        std::string cwd = jstr(s, "cwd");
        add(cwd, leafName(cwd), "session");
      }
    }
  }
  for (const auto& d : listSubdirs(cw, 30)) {
    add(jstr(d, "path"), jstr(d, "name"), "subdir");
  }
  // 用户自己建的/改过名字的项目：即使还没有会话，也要在列表里
  {
    json doc = readJsonFile(projectsFilePath());
    json projects = jval(doc, "projects", json::object());
    if (projects.is_object()) {
      for (auto it = projects.begin(); it != projects.end(); ++it) {
        add(jstr(it.value(), "path"), jstr(it.value(), "name"), "custom");
      }
    }
  }
  json active = activeWorkspaceInfo();
  return json{{"cwd", cw},
              {"workspace", jstr(active, "name", leafName(cw))},
              {"workspaceId", jstr(active, "id")},
              {"workspaceName", jstr(active, "name", leafName(cw))},
              {"workspaceFolders", foldersOf(active)},
              {"agentReady", agentReady_.load()},
              {"demo", demo_},
              {"workspaces", list}};
}

bool Backend::spawnWindow(const std::string& path) {
  if (exePath_.empty() || !isDirectoryPath(path)) return false;
  std::wstring exe = utf8ToWide(exePath_);
  std::wstring dir = utf8ToWide(path);
  std::wstring cmd = L"\"" + exe + L"\" --cwd \"" + dir + L"\" --new-window";
  STARTUPINFOW si{};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi{};
  std::vector<wchar_t> buf(cmd.begin(), cmd.end());
  buf.push_back(L'\0');
  BOOL ok = CreateProcessW(nullptr, buf.data(), nullptr, nullptr, FALSE, 0, nullptr, dir.c_str(), &si, &pi);
  if (!ok) {
    logf("spawn window 失败 code=" + std::to_string(GetLastError()));
    return false;
  }
  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);
  return true;
}

std::string Backend::pickFolder() {
  std::string out;
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
  bool uninit = SUCCEEDED(hr);
  IFileOpenDialog* dlg = nullptr;
  hr = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_ALL, IID_PPV_ARGS(&dlg));
  if (SUCCEEDED(hr) && dlg) {
    DWORD opts = 0;
    dlg->GetOptions(&opts);
    dlg->SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    if (SUCCEEDED(dlg->Show(GetForegroundWindow()))) {
      IShellItem* item = nullptr;
      if (SUCCEEDED(dlg->GetResult(&item)) && item) {
        PWSTR p = nullptr;
        if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &p)) && p) {
          out = wideToUtf8(p);
          CoTaskMemFree(p);
        }
        item->Release();
      }
    }
    dlg->Release();
  }
  if (uninit) CoUninitialize();
  return out;
}

json* Backend::findSession(const std::string& uiId) {
  auto& arr = store_["sessions"];
  for (auto& s : arr) {
    if (jstr(s, "id") == uiId) return &s;
  }
  return nullptr;
}

json Backend::createSession(const std::string& cwd, const std::string& title) {
  json s = {{"id", randomId("s_")},
            {"title", title.empty() ? "新会话" : title},
            {"cwd", cwd.empty() ? currentCwd() : cwd},
            {"acpSessionId", ""},
            {"model", selectedModel()},
            {"mode", "fullAccess"},
            {"config", json::object()},
            {"createdAt", nowMs()},
            {"updatedAt", nowMs()},
            {"events", json::array()},
            {"usage", {{"used", 0}, {"size", 0}, {"credits", 0.0}, {"charged", 0.0}}}};
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    store_["sessions"].push_back(s);
    store_["lastSessionId"] = s["id"];
  }
  saveStore();
  return s;
}

// 同一轮可能连发多条 usage_update，按 requestId 取最大值再算增量，
// 否则每条都累加会把积分翻好几倍。
void Backend::mergeUsage(json& session, const json& data) {
  json u = jval(session, "usage", json::object());
  if (!u.is_object()) u = json::object();
  if (data.contains("used")) u["used"] = data["used"];
  if (data.contains("size")) u["size"] = data["size"];

  double nominal = numAt(data, "originalCredit", -1);
  if (nominal < 0) nominal = numAt(data, "credit", 0);
  double actual = numAt(data, "credit", 0);
  if (actual <= 0 && data.contains("cost") && data["cost"].is_object())
    actual = numAt(data["cost"], "amount", 0);
  if (nominal <= 0 && actual > 0) nominal = actual;

  if (nominal > 0 || actual > 0) {
    std::string rid = jstr(data, "requestId");
    json byReq = jval(u, "byRequest", json::object());
    if (!byReq.is_object()) byReq = json::object();

    double prevNominal = 0, prevActual = 0;
    if (!rid.empty() && byReq.contains(rid) && byReq[rid].is_object()) {
      prevNominal = numAt(byReq[rid], "nominal", 0);
      prevActual = numAt(byReq[rid], "actual", 0);
    }
    double deltaNominal = std::max(0.0, nominal - prevNominal);
    double deltaActual = std::max(0.0, actual - prevActual);
    if (rid.empty()) {
      deltaNominal = nominal;
      deltaActual = actual;
    }

    u["credits"] = numAt(u, "credits", 0) + deltaNominal;
    u["charged"] = numAt(u, "charged", 0) + deltaActual;

    json daily = jval(u, "daily", json::object());
    if (!daily.is_object()) daily = json::object();
    std::string day = todayKey();
    daily[day] = numAt(daily, day.c_str(), 0) + deltaNominal;
    u["daily"] = daily;

    if (!rid.empty()) byReq[rid] = {{"nominal", nominal}, {"actual", actual}};
    u["byRequest"] = byReq;
    u["lastTurn"] = {{"nominal", nominal}, {"actual", actual}, {"at", nowMs()}};
  }

  if (data.contains("quota") && data["quota"].is_object()) u["quota"] = data["quota"];
  if (data.contains("tokens") && data["tokens"].is_object()) u["tokens"] = data["tokens"];
  session["usage"] = u;
}

void Backend::appendEvent(const std::string& uiId, const std::string& type, json data) {
  // 这几类只用于当下渲染，落盘会把会话文件撑大且无回放价值
  static const std::set<std::string> transient = {"commands", "config", "mode", "raw_update", "models"};
  std::lock_guard<std::mutex> lk(storeMu_);
  json* s = findSession(uiId);
  if (!s) return;
  if (!transient.count(type)) {
    json& evs = (*s)["events"];
    if (!evs.is_array()) evs = json::array();
    // 流式文本直接并进上一条，避免一个会话存出十万级事件
    if (evs.empty() || !mergeStreamingEvent(evs.back(), type, data)) {
      evs.push_back({{"type", type}, {"data", data}});
      if (evs.size() > kSessionEventCap * 2) compactSessionEvents(evs, kSessionEventCap);
    }
  }
  (*s)["updatedAt"] = nowMs();
  if (type == "usage") mergeUsage(*s, data);
}

void Backend::emit(const std::string& uiId, const std::string& type, json data) {
  appendEvent(uiId, type, data);
  bus_.push(type, uiId, std::move(data));
}

std::string Backend::acpSessionFor(const std::string& uiId, std::string& err) {
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    auto it = uiToAcp_.find(uiId);
    if (it != uiToAcp_.end() && !it->second.empty()) return it->second;
  }
  std::string cwd;
  std::string storedAcp;
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    json* s = findSession(uiId);
    if (!s) {
      err = "会话不存在";
      return "";
    }
    cwd = jstr(*s, "cwd", currentCwd());
    storedAcp = jstr(*s, "acpSessionId");
  }
  json info;
  try {
    if (!ensureAgent(err)) return "";
    // 重启应用后继续旧会话：先让 CLI 把历史会话 load 回来，再建立映射。
    // 重放事件此时还没有 uiId，会被 onUpdate 直接丢掉，不会重复灌进界面。
    if (!storedAcp.empty()) {
      try {
        info = client_->loadSession(storedAcp, cwd, teamMcpServers());
        if (!info.is_object()) info = json::object();
        if (info.empty()) info = json{{"sessionId", storedAcp}};
      } catch (const std::exception& e) {
        logf("load session " + storedAcp + " 失败，改开新会话: " + e.what());
        info = json::object();
      }
    }
    if (info.empty()) {
      info = takeSpareSession(cwd);
      if (!info.is_object() || info.empty()) info = client_->newSessionInfo(cwd, teamMcpServers());
    }
  } catch (const std::exception& e) {
    err = e.what();
    return "";
  }
  std::string acpSid = jstr(info, "sessionId", storedAcp);
  if (acpSid.empty()) {
    err = "创建 ACP 会话失败";
    return "";
  }
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    uiToAcp_[uiId] = acpSid;
    acpToUi_[acpSid] = uiId;
  }
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    if (json* ss = findSession(uiId)) {
      (*ss)["acpSessionId"] = acpSid;
      if (jstr(*ss, "model").empty()) {
        (*ss)["model"] = jstr(jval(info, "models", json::object()), "currentModelId", selectedModel());
      }
    }
  }
  absorbSessionInfo(info, uiId);
  return acpSid;
}

json Backend::saveImages(const json& incoming) {
  json out = json::array();
  if (!incoming.is_array()) return out;
  std::string dir = localAppDir() + "\\images";
  CreateDirectoryA(dir.c_str(), nullptr);

  int saved = 0;
  for (const auto& img : incoming) {
    if (saved >= 4 || !img.is_object()) break;
    std::string mime = jstr(img, "mime", "image/png");
    std::string b64 = jstr(img, "data");
    // 12MB base64 ≈ 9MB 原图，再大就不该走这个壳传了
    if (b64.empty() || b64.size() > 12u * 1024 * 1024) continue;
    std::string bin = base64Decode(b64);
    if (bin.empty()) continue;

    std::string fileName = randomId("img_") + imageExtFor(mime);
    std::ofstream f(dir + "\\" + fileName, std::ios::binary | std::ios::trunc);
    if (!f) continue;
    f.write(bin.data(), static_cast<std::streamsize>(bin.size()));
    if (!f) continue;
    f.close();

    out.push_back({{"url", "/api/images/" + fileName},
                   {"mime", mime},
                   {"name", jstr(img, "name", "图片")}});
    ++saved;
  }
  return out;
}

void Backend::handleCatalog(const httplib::Request&, httplib::Response& res) {
  try {
    res.set_content(dumpJson(buildCatalog(currentCwd())), "application/json; charset=utf-8");
  } catch (const std::exception& e) {
    logf(std::string("buildCatalog 失败: ") + e.what());
    res.set_content(dumpJson(json{{"skills", json::array()},
                                  {"connectors", json::array()},
                                  {"plugins", json::array()},
                                  {"marketplaces", json::array()}}),
                    "application/json; charset=utf-8");
  }
}

// ---------------------------------------------------------------- 插件市场
// 真实安装态只认 CLI 的 installed_plugins.json / known_marketplaces.json；
// 这里只负责把 CLI 的 marketplace 命令包成带超时的 HTTP 接口。

void Backend::initDemoMarket() {
  auto plugin = [](const std::string& name, const std::string& market, const std::string& src,
                   const std::string& desc, const std::string& version, const std::string& category,
                   bool installed) {
    std::string key = name + "@" + market;
    return json{{"name", name},
                {"marketplace", market},
                {"description", desc},
                {"version", version},
                {"category", category},
                {"author", "CodeBuddy"},
                {"installed", installed},
                {"enabled", installed},
                {"installVersion", installed ? version : ""},
                {"installPath", installed ? "~/.codebuddy/plugins/cache/" + market + "/" + name + "/" +
                                                version
                                          : ""},
                {"scope", installed ? "user" : ""},
                {"source", src},
                {"key", key}};
  };

  const std::string official = "https://download.codebuddy.cn/plugin-marketplace/codebuddy-plugins-official.zip";
  const std::string teams = "https://download.codebuddy.cn/plugin-marketplace/cb_teams_marketplace.zip";
  const std::string harness = "https://github.com/revfactory/harness";

  json markets = json::array();
  markets.push_back(json{{"name", "codebuddy-plugins-official"},
                         {"description", "CodeBuddy 官方插件市场"},
                         {"type", "zip"},
                         {"source", official},
                         {"builtIn", true},
                         {"lastUpdated", "2026-11-16T01:45:58.547Z"},
                         {"installLocation", "~/.codebuddy/plugins/marketplaces/codebuddy-plugins-official"}});
  markets.push_back(json{{"name", "cb_teams_marketplace"},
                         {"description", "团队协作与文档处理插件集合"},
                         {"type", "zip"},
                         {"source", teams},
                         {"builtIn", true},
                         {"lastUpdated", "2026-11-17T01:47:15.749Z"},
                         {"installLocation", "~/.codebuddy/plugins/marketplaces/cb_teams_marketplace"}});
  markets.push_back(json{{"name", "harness-marketplace"},
                         {"description", "Marketplace from revfactory/harness"},
                         {"type", "github"},
                         {"source", harness},
                         {"builtIn", false},
                         {"lastUpdated", "2026-11-16T03:13:28.301Z"},
                         {"installLocation", "~/.codebuddy/plugins/marketplaces/harness-marketplace"}});

  json plugins = json::array(
      {plugin("pdf", "codebuddy-plugins-official", official, "PDF 读取、拆分、合并与表单填充", "1.0.0", "文档", true),
       plugin("docx", "codebuddy-plugins-official", official, "Word 文档生成与排版美化", "0.9.2", "文档", true),
       plugin("xlsx", "codebuddy-plugins-official", official, "Excel 表格编辑、透视与公式计算", "1.2.0", "文档", true),
       plugin("agent-browser", "codebuddy-plugins-official", official, "浏览器自动化与网页截图", "1.3.0", "自动化", true),
       plugin("code-simplifier", "codebuddy-plugins-official", official, "审查并简化改动过的代码，保持行为不变", "0.4.1", "代码质量", false),
       plugin("context7", "codebuddy-plugins-official", official, "按版本检索第三方库文档并注入上下文", "0.2.0", "文档检索", false),
       plugin("document-skills", "cb_teams_marketplace", teams, "团队文档协作技能合集（合同、报告、纪要）", "1.0.0", "文档", true),
       plugin("lark-suite", "cb_teams_marketplace", teams, "飞书表格、审批与日程的团队工具集", "2.4.0", "协作", true),
       plugin("team-report", "cb_teams_marketplace", teams, "从多维表格汇总周报并导出图表", "0.6.0", "协作", false),
       plugin("okr-assistant", "cb_teams_marketplace", teams, "对齐季度 OKR 并检查关键结果口径", "0.3.2", "协作", false),
       plugin("harness", "harness-marketplace", harness, "按项目结构设计专用 Harness 与专家代理", "2.1.0", "工作流", false),
       plugin("evolve", "harness-marketplace", harness, "根据执行结果迭代已有 Harness", "1.0.3", "工作流", false),
       plugin("planner", "harness-marketplace", harness, "把大任务拆成可验证的阶段计划", "0.8.0", "工作流", true)});

  std::lock_guard<std::mutex> lk(marketMu_);
  demoMarket_ = json{{"marketplaces", markets}, {"plugins", plugins}};
  marketJobs_.clear();
}

json Backend::marketDemoSnapshot() {
  std::lock_guard<std::mutex> lk(marketMu_);
  json markets = jval(demoMarket_, "marketplaces", json::array());
  json plugins = jval(demoMarket_, "plugins", json::array());
  for (auto& m : markets) {
    int instCount = 0;
    int availCount = 0;
    for (const auto& p : plugins) {
      if (jstr(p, "marketplace") != jstr(m, "name")) continue;
      if (p.value("installed", false)) ++instCount;
      else ++availCount;
    }
    m["pluginCount"] = instCount + availCount;
    m["installedCount"] = instCount;
    m["availableCount"] = availCount;
  }
  int instTotal = 0;
  for (const auto& p : plugins)
    if (p.value("installed", false)) ++instTotal;
  return json{{"marketplaces", markets},
              {"plugins", plugins},
              {"totals", {{"marketplaces", markets.size()},
                          {"plugins", plugins.size()},
                          {"installed", instTotal},
                          {"available", static_cast<int>(plugins.size()) - instTotal}}},
              {"loadedAt", nowMs()}};
}

json Backend::marketOverview() {
  if (demo_) return marketDemoSnapshot();
  return buildMarketOverview();
}

json Backend::demoParseMarket(const std::string& url, const std::string& name) {
  std::lock_guard<std::mutex> lk(marketMu_);
  json markets = jval(demoMarket_, "marketplaces", json::array());
  json plugins = jval(demoMarket_, "plugins", json::array());
  for (const auto& m : markets) {
    if (jstr(m, "name") != name) continue;
    json outPlugins = json::array();
    for (const auto& p : plugins)
      if (jstr(p, "marketplace") == name) outPlugins.push_back(p);
    return json{{"ok", true},
                {"demo", true},
                {"added", false},
                {"url", url},
                {"marketplace", m},
                {"plugins", outPlugins},
                {"message", "该市场已在本地，已刷新清单"}};
  }

  std::string type = "git";
  std::string low = url;
  for (auto& c : low) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  if (low.find("github.com") != std::string::npos) type = "github";
  if (low.size() > 4 && low.substr(low.size() - 4) == ".zip") type = "zip";

  std::string desc = "从 " + url + " 解析的演示市场";
  json market = {{"name", name},
                 {"description", desc},
                 {"type", type},
                 {"source", url},
                 {"builtIn", false},
                 {"pluginCount", 0},
                 {"installedCount", 0},
                 {"availableCount", 0},
                 {"lastUpdated", nowIso()},
                 {"installLocation", "~/.codebuddy/plugins/marketplaces/" + name}};

  auto mk = [&](const std::string& suffix, const std::string& text, const std::string& version,
                const std::string& category, bool installed) {
    std::string pName = name + "-" + suffix;
    std::string key = pName + "@" + name;
    return json{{"name", pName},
                {"marketplace", name},
                {"description", text},
                {"version", version},
                {"category", category},
                {"author", name},
                {"installed", installed},
                {"enabled", installed},
                {"installVersion", installed ? version : ""},
                {"installPath", installed ? "~/.codebuddy/plugins/cache/" + name + "/" + pName + "/" + version : ""},
                {"scope", installed ? "user" : ""},
                {"source", url},
                {"key", key}};
  };

  json fresh = json::array({mk("mcp", "把仓库里的接口定义注册为 MCP 工具，供对话直接调用", "0.3.0", "集成", false),
                            mk("review", "按仓库约定做提交前代码审查，标出风险与缺失测试", "0.5.1", "代码质量", false),
                            mk("docs", "从源码注释生成使用文档并同步到仓库 docs 目录", "1.0.2", "文档", true),
                            mk("release", "根据提交记录生成发布说明与版本号建议", "0.7.0", "工作流", false)});

  markets.push_back(market);
  for (const auto& p : fresh) plugins.push_back(p);
  demoMarket_ = json{{"marketplaces", markets}, {"plugins", plugins}};

  for (auto& m : markets) {
    if (jstr(m, "name") != name) continue;
    int instCount = 0;
    int availCount = 0;
    for (const auto& p : fresh) {
      if (p.value("installed", false)) ++instCount;
      else ++availCount;
    }
    m["pluginCount"] = instCount + availCount;
    m["installedCount"] = instCount;
    m["availableCount"] = availCount;
    return json{{"ok", true},
                {"demo", true},
                {"added", true},
                {"url", url},
                {"marketplace", m},
                {"plugins", fresh},
                {"message", "已解析 4 个插件（演示数据）"}};
  }
  return json{{"ok", false}, {"error", "解析失败"}};
}

json Backend::demoApplyInstalled(const std::string& key, bool installed, std::string& err) {
  std::lock_guard<std::mutex> lk(marketMu_);
  json plugins = jval(demoMarket_, "plugins", json::array());
  for (auto& p : plugins) {
    if (jstr(p, "key") != key) continue;
    p["installed"] = installed;
    p["enabled"] = installed;
    if (installed) {
      p["installVersion"] = jstr(p, "version");
      p["installPath"] = "~/.codebuddy/plugins/cache/" + jstr(p, "marketplace") + "/" + jstr(p, "name") +
                         "/" + jstr(p, "version");
      p["scope"] = "user";
    } else {
      p["installVersion"] = "";
      p["installPath"] = "";
      p["scope"] = "";
    }
    demoMarket_["plugins"] = plugins;
    return p;
  }
  err = "演示数据里找不到插件 " + key;
  return json();
}

void Backend::startMarketJob(const std::string& action, const std::string& plugin,
                             const std::string& marketplace, const std::string& jobId) {
  const std::string key = plugin + "@" + marketplace;
  json job = {{"id", jobId},
              {"action", action},
              {"plugin", plugin},
              {"marketplace", marketplace},
              {"key", key},
              {"status", "running"},
              {"startedAt", nowMs()},
              {"finishedAt", 0},
              {"output", ""},
              {"error", ""}};
  {
    std::lock_guard<std::mutex> lk(marketMu_);
    marketJobs_[jobId] = job;
    while (marketJobs_.size() > 40) marketJobs_.erase(marketJobs_.begin());
  }

  std::thread([this, action, key, jobId] {
    json result;
    std::string err;
    std::string output;
    if (demo_) {
      result = demoApplyInstalled(key, action == "install", err);
    } else {
      std::vector<std::string> args{"plugin", action == "install" ? "install" : "uninstall", key,
                                    "--scope", "user"};
      if (action != "install") {
        args.push_back("--keep-data");
        args.push_back("-y");
      }
      CmdResult r = runCli(args, currentCwd(), action == "install" ? 180000 : 60000);
      output = tailText(r.out, 1200);
      if (r.timedOut) {
        err = action == "install"
                  ? "codebuddy plugin install 超时（180s）。请检查网络或稍后重试。"
                  : "codebuddy plugin uninstall 超时（60s）。";
      } else if (!r.ok) {
        err = output.empty() ? ("codebuddy 退出码 " + std::to_string(r.code) + "，没有输出") : output;
        if (err.find("未找到") == std::string::npos && err.find("not found") == std::string::npos &&
            err.find("ENOENT") == std::string::npos) {
          err = "CLI 执行失败：" + err;
        }
      }
    }

    {
      std::lock_guard<std::mutex> lk(marketMu_);
      auto it = marketJobs_.find(jobId);
      if (it == marketJobs_.end()) return;
      (*it).second["status"] = err.empty() ? "ok" : "error";
      (*it).second["finishedAt"] = nowMs();
      (*it).second["error"] = err;
      (*it).second["output"] = output;
      if (!result.is_null()) (*it).second["pluginState"] = result;
    }
  }).detach();
}

json Backend::findMarketJob(const std::string& id) {
  std::lock_guard<std::mutex> lk(marketMu_);
  auto it = marketJobs_.find(id);
  return it == marketJobs_.end() ? json() : it->second;
}

void Backend::handleMarketOverview(const httplib::Request&, httplib::Response& res) {
  try {
    json out = marketOverview();
    out["demo"] = demo_;
    out["cli"] = "codebuddy";
    res.set_header("Cache-Control", "no-store");
    res.set_content(dumpJson(out), "application/json; charset=utf-8");
  } catch (const std::exception& e) {
    logf(std::string("market overview 失败: ") + e.what());
    res.status = 500;
    res.set_content(dumpJson(json{{"error", std::string("读取插件市场失败：") + e.what()}}),
                    "application/json; charset=utf-8");
  }
}

json Backend::runMarketParse(const std::string& url, std::string name, int& status) {
  status = 200;
  const std::string knownPath = homePath() + "\\.codebuddy\\plugins\\known_marketplaces.json";
  auto norm = [](std::string s) {
    s = trimStr(s);
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    while (!s.empty() && s.back() == '/') s.pop_back();
    if (s.size() > 4 && s.substr(s.size() - 4) == ".git") s.resize(s.size() - 4);
    return s;
  };
  auto sameSource = [&](const json& m) {
    json src = jval(m, "source", json::object());
    std::string target = norm(url);
    std::string repo = jstr(src, "repo");
    std::vector<std::string> cands{jstr(src, "url"), jstr(src, "path"), repo};
    if (!repo.empty()) cands.push_back("https://github.com/" + repo);
    for (const auto& c : cands) {
      if (!c.empty() && norm(c) == target) return true;
    }
    return false;
  };

  json known = readJsonFile(knownPath);
  std::string actualName;
  bool existed = false;
  for (auto it = known.begin(); it != known.end(); ++it) {
    if (!it.value().is_object()) continue;
    if (it.key() == name && sameSource(it.value())) {
      actualName = jstr(it.value(), "manifestName", it.key());
      existed = true;
      break;
    }
    if (sameSource(it.value())) {
      actualName = jstr(it.value(), "manifestName", it.key());
      existed = true;
      break;
    }
  }
  if (!existed && known.contains(name)) {
    // 同名但来源不同：加一段短后缀，避免覆盖用户已有的市场
    size_t h = std::hash<std::string>{}(url) % 0xffff;
    char suffix[8];
    snprintf(suffix, sizeof(suffix), "-%04zx", h);
    name += suffix;
  }

  CmdResult r;
  if (existed && !actualName.empty()) {
    r = runCli({"plugin", "marketplace", "update", actualName}, currentCwd(), 45000);
  } else {
    r = runCli({"plugin", "marketplace", "add", url, "--name", name}, currentCwd(), 60000);
  }

  std::string warning;
  if (r.timedOut) {
    if (!existed) {
      status = 504;
      return json{{"ok", false}, {"error", "解析市场超时（60s），请检查网络后重试"}};
    }
    warning = "更新超时（45s），展示本地缓存清单";
  } else if (!r.ok) {
    std::string detail = tailText(r.out, 800);
    if (!existed) {
      status = 502;
      return json{{"ok", false},
                  {"error", detail.empty() ? "codebuddy plugin marketplace 执行失败，退出码 " +
                                                 std::to_string(r.code)
                                           : detail},
                  {"output", detail}};
    }
    warning = "更新失败，展示本地缓存清单" + (detail.empty() ? "" : "：" + detail);
  } else if (existed) {
    warning = "市场已存在，已刷新清单";
  }

  // marketplace add 成功后重新读 CLI 的真实状态，找市场实际名字（可能与 --name 不同）
  json known2 = readJsonFile(knownPath);
  std::string resolved = actualName.empty() ? name : actualName;
  for (auto it = known2.begin(); it != known2.end(); ++it) {
    if (!it.value().is_object()) continue;
    if (it.key() == name || jstr(it.value(), "manifestName") == name || sameSource(it.value())) {
      resolved = jstr(it.value(), "manifestName", it.key());
      break;
    }
  }

  json ov;
  try {
    ov = buildMarketOverview();
  } catch (const std::exception& e) {
    status = 500;
    return json{{"ok", false}, {"error", std::string("市场已添加，但读取清单失败：") + e.what()}};
  }
  json market = json::object();
  for (const auto& m : jval(ov, "marketplaces", json::array())) {
    if (jstr(m, "name") == resolved) {
      market = m;
      break;
    }
  }
  if (market.is_null() || market.empty()) {
    status = 502;
    return json{{"ok", false},
                {"error",
                 "市场已添加，但没有找到 .codebuddy-plugin/marketplace.json。"
                 "请确认地址指向插件市场仓库，而不是单个插件。"},
                {"output", tailText(r.out, 500)}};
  }
  json list = json::array();
  for (const auto& p : jval(ov, "plugins", json::array())) {
    if (jstr(p, "marketplace") == resolved) list.push_back(p);
  }
  json out = {{"ok", true},
              {"demo", false},
              {"added", !existed},
              {"url", url},
              {"marketplace", market},
              {"plugins", list},
              {"output", tailText(r.out, 500)}};
  if (!warning.empty()) out["warning"] = warning;
  return out;
}

void Backend::startMarketParseJob(const std::string& url, const std::string& name,
                                  const std::string& jobId) {
  json job = {{"id", jobId},
              {"action", "parse"},
              {"url", url},
              {"name", name},
              {"status", "running"},
              {"startedAt", nowMs()},
              {"finishedAt", 0},
              {"error", ""}};
  {
    std::lock_guard<std::mutex> lk(marketMu_);
    marketJobs_[jobId] = job;
    while (marketJobs_.size() > 40) marketJobs_.erase(marketJobs_.begin());
  }

  std::thread([this, url, name, jobId] {
    int status = 200;
    json result = demo_ ? demoParseMarket(url, name) : runMarketParse(url, name, status);
    bool ok = result.value("ok", false);
    std::string err = ok ? "" : jstr(result, "error", "解析失败");
    {
      std::lock_guard<std::mutex> lk(marketMu_);
      auto it = marketJobs_.find(jobId);
      if (it == marketJobs_.end()) return;
      (*it).second["status"] = ok ? "ok" : "error";
      (*it).second["finishedAt"] = nowMs();
      (*it).second["error"] = err;
      (*it).second["result"] = result;
    }
  }).detach();
}

void Backend::handleMarketParse(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string url = trimStr(jstr(body, "url"));
  if (url.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "请输入插件市场地址"}}), "application/json; charset=utf-8");
    return;
  }
  if (url.size() > 500 || !looksLikeMarketSource(url)) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "地址格式不支持：请使用 https://…、GitHub owner/repo 或本地路径"}}),
                    "application/json; charset=utf-8");
    return;
  }
  std::string name = trimStr(jstr(body, "name"));
  if (name.empty()) name = marketNameFromUrl(url);
  if (!safeMarketToken(name) || name.find('@') != std::string::npos) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "无法从地址推导市场名，请用 name 字段显式指定"}}),
                    "application/json; charset=utf-8");
    return;
  }
  std::string jobId = randomId("mp_");
  startMarketParseJob(url, name, jobId);
  res.status = 202;
  res.set_content(dumpJson(json{{"ok", true}, {"job", findMarketJob(jobId)}}),
                  "application/json; charset=utf-8");
}

void Backend::handleMarketInstall(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string plugin = trimStr(jstr(body, "plugin"));
  std::string marketplace = trimStr(jstr(body, "marketplace"));
  if (plugin.empty() || marketplace.empty() || plugin.find('@') != std::string::npos ||
      marketplace.find('@') != std::string::npos || !safeMarketToken(plugin) ||
      !safeMarketToken(marketplace)) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少合法的 plugin / marketplace 参数"}}),
                    "application/json; charset=utf-8");
    return;
  }
  std::string jobId = randomId("mk_");
  startMarketJob("install", plugin, marketplace, jobId);
  res.status = 202;
  res.set_content(dumpJson(json{{"ok", true}, {"job", findMarketJob(jobId)}}),
                  "application/json; charset=utf-8");
}

void Backend::handleMarketUninstall(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string plugin = trimStr(jstr(body, "plugin"));
  std::string marketplace = trimStr(jstr(body, "marketplace"));
  if (plugin.empty() || marketplace.empty() || plugin.find('@') != std::string::npos ||
      marketplace.find('@') != std::string::npos || !safeMarketToken(plugin) ||
      !safeMarketToken(marketplace)) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少合法的 plugin / marketplace 参数"}}),
                    "application/json; charset=utf-8");
    return;
  }
  std::string jobId = randomId("mk_");
  startMarketJob("uninstall", plugin, marketplace, jobId);
  res.status = 202;
  res.set_content(dumpJson(json{{"ok", true}, {"job", findMarketJob(jobId)}}),
                  "application/json; charset=utf-8");
}

void Backend::handleMarketJob(const httplib::Request& req, httplib::Response& res) {
  std::string id = req.has_param("id") ? req.get_param_value("id") : "";
  json job = id.empty() ? json() : findMarketJob(id);
  res.set_header("Cache-Control", "no-store");
  if (job.is_null()) {
    res.status = 404;
    res.set_content(dumpJson(json{{"error", "任务不存在或已过期"}}), "application/json; charset=utf-8");
    return;
  }
  res.set_content(dumpJson(json{{"ok", true}, {"job", job}}), "application/json; charset=utf-8");
}

void Backend::handleImage(const httplib::Request& req, httplib::Response& res) {  std::string name = req.matches.size() > 1 ? req.matches[1].str() : "";
  if (name.empty() || name.find("..") != std::string::npos ||
      name.find('/') != std::string::npos || name.find('\\') != std::string::npos) {
    res.status = 400;
    return;
  }
  std::ifstream in(localAppDir() + "\\images\\" + name, std::ios::binary);
  if (!in) {
    res.status = 404;
    return;
  }
  std::stringstream ss;
  ss << in.rdbuf();
  res.set_header("Cache-Control", "max-age=86400");
  res.set_content(ss.str(), contentTypeFor(name));
}

void Backend::runPrompt(const std::string& uiId, const std::string& text, const std::string& mode,
                        const json& images, const std::string& model) {
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.insert(uiId);
  }
  std::string err;
  std::string acpSid = acpSessionFor(uiId, err);
  if (acpSid.empty()) {
    emit(uiId, "error", json{{"message", err}});
    emit(uiId, "done", json{{"stopReason", "error"}});
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
    return;
  }
  // 每次 set_config_option 都会带回权威的全量 configOptions；顺手更新快照，
  // 避免 /api/models 停留在预会话或进程重启前的旧值。
  bool configRefreshed = false;
  auto applyOption = [&](const std::string& id, const json& value, const std::string& type) {
    json result = client_->setConfigOption(acpSid, id, value, type);
    json options = jval(result, "configOptions", json::array());
    if (options.is_array() && !options.empty()) {
      std::lock_guard<std::mutex> lk(modelMu_);
      configOptions_ = options;
      configRefreshed = true;
    }
  };
  try {
    if (!model.empty()) applyOption("model", model, "");
  } catch (const std::exception& e) {
    logf(std::string("set model 失败: ") + e.what());
  }
  try {
    if (!mode.empty()) applyOption("mode", mode, "");
  } catch (const std::exception& e) {
    logf(std::string("setConfigOption 失败: ") + e.what());
  }
  // 会话级配置（effort / sandbox / multitask / context_window …）每轮同步一次，
  // 新建 ACP 会话或进程重启后都能回到用户上次的选择。
  json sessionConfig = json::object();
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    if (json* s = findSession(uiId)) sessionConfig = jval(*s, "config", json::object());
  }
  if (sessionConfig.is_object()) {
    for (auto it = sessionConfig.begin(); it != sessionConfig.end(); ++it) {
      const std::string& id = it.key();
      if (id == "model" || id == "mode") continue;
      const json& value = it.value();
      std::string type = value.is_boolean() ? "boolean" : (value.is_string() ? "select" : "");
      if (type.empty()) continue;
      try {
        applyOption(id, value, type);
      } catch (const std::exception& e) {
        logf("set config " + id + " 失败: " + e.what());
      }
    }
  }
  // 把真正生效的档位推给 UI；session/load 回来的快照可能是旧默认值
  if (configRefreshed) {
    json options;
    {
      std::lock_guard<std::mutex> lk(modelMu_);
      options = configOptions_;
    }
    if (options.is_array() && !options.empty()) emit(uiId, "config", json{{"options", options}});
  }
  try {
    json result = client_->prompt(acpSid, text, images);
    emit(uiId, "done", json{{"stopReason", jstr(result, "stopReason", "end_turn")}});
  } catch (const std::exception& e) {
    std::string msg = e.what();
    if (isAuthError(msg)) {
      emit(uiId, "auth_required",
           json{{"message",
                 "CodeBuddy 还没登录，无法调用模型。请在终端运行 codebuddy 并执行 /login，"
                 "或用 CODEBUDDY_API_KEY 环境变量提供密钥后重启本应用。"}});
    } else {
      emit(uiId, "error", json{{"message", msg}});
    }
    emit(uiId, "done", json{{"stopReason", "error"}});
  }
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
  }
  saveStore();
}

// ---------- 演示运行时：产出与真实 ACP 同构的事件，方便没有登录态时验证界面 ----------
void Backend::runDemo(const std::string& uiId, const std::string& text) {
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.insert(uiId);
  }
  auto sleepMs = [](int ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); };
  auto alive = [&] {
    std::lock_guard<std::mutex> lk(mapMu_);
    return running_.count(uiId) > 0;
  };

  std::string fileName = "demo-note.md";
  std::string body = "# 演示产物\n\n你刚才说：「" + text +
                     "」\n\n这份文件由内置演示代理生成，用来验证流式输出、工具卡片、权限审批和 diff 渲染。\n";

  sleepMs(150);
  emit(uiId, "thought", json{{"text", "先判断这是个要落盘的请求，"}});
  sleepMs(350);
  emit(uiId, "thought", json{{"text", "路径定了就直接写。"}});
  emit(uiId, "plan",
       json{{"entries", json::array({{{"content", "看清当前目录"}, {"status", "in_progress"}},
                                     {{"content", "把结论写成文件"}, {"status", "pending"}},
                                     {{"content", "读回核验"}, {"status", "pending"}}})}});

  sleepMs(250);
  std::string toolId = randomId("tool_");
  emit(uiId, "tool",
       json{{"id", toolId},
            {"title", "写入 " + fileName},
            {"kind", "edit"},
            {"status", "pending"},
            {"content", json::array()},
            {"rawInput", {{"path", fileName}, {"bytes", (int)body.size()}}}});

  std::string requestId = randomId("perm_");
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    pendingPerm_[requestId] = {0, uiId};  // 演示模式没有 RPC id，占位即可
  }
  emit(uiId, "permission",
       json{{"requestId", requestId},
            {"title", "允许写入 " + fileName + " ？"},
            {"kind", "edit"},
            {"toolCallId", toolId},
            {"options", json::array({{{"optionId", "allow_once"}, {"name", "允许一次"}},
                                     {{"optionId", "allow_always"}, {"name", "本会话都允许"}},
                                     {{"optionId", "reject_once"}, {"name", "拒绝"}}})}});

  // 等前端点按钮（最多 20 秒自动放行）
  std::string optionId;
  for (int i = 0; i < 200; ++i) {
    if (!alive()) break;
    {
      std::lock_guard<std::mutex> lk(mapMu_);
      auto it = permResults_.find(requestId);
      if (it != permResults_.end()) {
        optionId = it->second;
        permResults_.erase(it);
        break;
      }
    }
    sleepMs(100);
  }
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    pendingPerm_.erase(requestId);
  }
  if (optionId.empty()) optionId = alive() ? "allow_once" : "cancelled";
  emit(uiId, "permission_resolved", json{{"requestId", requestId}, {"optionId", optionId}});
  if (optionId == "cancelled") {
    emit(uiId, "tool_update", json{{"id", toolId}, {"status", "cancelled"}});
    emit(uiId, "done", json{{"stopReason", "cancelled"}});
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
    return;
  }

  if (optionId.rfind("reject", 0) == 0) {
    emit(uiId, "tool_update", json{{"id", toolId}, {"status", "failed"}});
    emit(uiId, "text", json{{"text", "好的，这次不写文件。"}});
    emit(uiId, "done", json{{"stopReason", "end_turn"}});
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
    return;
  }

  emit(uiId, "tool_update", json{{"id", toolId}, {"status", "in_progress"}});
  sleepMs(600);
  emit(uiId, "tool_update",
       json{{"id", toolId},
            {"status", "completed"},
            {"content", json::array({{{"type", "diff"},
                                      {"path", fileName},
                                      {"oldText", ""},
                                      {"newText", body}},
                                     {{"type", "text"}, {"text", "已写入 " + std::to_string(body.size()) + " 字节"}}})}});

  std::string answer =
      "已经处理完了。\n\n**做了什么**\n1. 解析请求：「" + utf8Truncate(text, 60) + "」\n2. 写入 `" +
      fileName + "`\n3. 读回校验，内容一致\n\n> 这条回答来自演示代理，用于验证流式渲染与工具卡片，"
      "不含真实模型推理。\n\n要接真实模型：终端里运行 `codebuddy` 完成 `/login`，再重启本应用。";
  // 严格按 UTF-8 字符推进，切半个汉字会让 json 序列化直接抛异常
  for (size_t i = 0; i < answer.size();) {
    unsigned char c = static_cast<unsigned char>(answer[i]);
    size_t len = 1;
    if ((c & 0xE0) == 0xC0) len = 2;
    else if ((c & 0xF0) == 0xE0) len = 3;
    else if ((c & 0xF8) == 0xF0) len = 4;
    if (i + len > answer.size()) len = answer.size() - i;
    emit(uiId, "text", json{{"text", answer.substr(i, len)}});
    i += len;
    sleepMs(18);
  }
  emit(uiId, "usage",
       json{{"used", 15800},
            {"size", 1000000},
            {"credit", 0.0},
            {"originalCredit", 4.37},
            {"requestId", randomId("req_")},
            {"quota",
             {{"model", "hy4"}, {"percent", 12.5}, {"resetAt", nowMs() + 86400000}, {"sharedModels", json::array()}}},
            {"tokens", {{"inputTokens", 15800}, {"outputTokens", 420}, {"totalTokens", 16220}}}});
  emit(uiId, "done", json{{"stopReason", "end_turn"}});
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
  }
  saveStore();
}

// ---------------------------- 路由 ----------------------------

void Backend::handleBootstrap(const httplib::Request&, httplib::Response& res) {
  const std::string cw = currentCwd();
  const std::string today = todayKey();
  json sessions = json::array();
  std::string lastId;
  std::string storedLast;
  bool storedIsCurrent = false;
  double credits = 0, charged = 0, todayCredits = 0;
  json quota = json::object();
  int64_t quotaAt = 0;
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    storedLast = jstr(store_, "lastSessionId");
    const auto& all = jval(store_, "sessions", json::array());
    for (auto it = all.rbegin(); it != all.rend(); ++it) {
      const json& s = *it;
      std::string id = jstr(s, "id");
      bool here = samePath(jstr(s, "cwd"), cw);
      if (here) {
        if (lastId.empty() && !fresh_) lastId = id;
        if (id == storedLast) storedIsCurrent = true;
      }
      json u = jval(s, "usage", json::object());
      if (here) {
        credits += numAt(u, "credits", 0);
        charged += numAt(u, "charged", 0);
        json daily = jval(u, "daily", json::object());
        if (daily.is_object()) todayCredits += numAt(daily, today.c_str(), 0);
      }
      json q = jval(u, "quota", json::object());
      if (q.is_object() && !q.empty()) {
        int64_t at = static_cast<int64_t>(numAt(jval(u, "lastTurn", json::object()), "at", 0));
        if (at == 0) at = s.value("updatedAt", static_cast<int64_t>(0));
        if (at >= quotaAt) {
          quotaAt = at;
          quota = q;
        }
      }
      // 别用 jval 取 events：它是按值返回，会把整份事件数组深拷贝一遍
      auto evIt = s.find("events");
      int64_t msgCount =
          (evIt != s.end() && evIt->is_array()) ? static_cast<int64_t>(evIt->size()) : 0;
      sessions.push_back({{"id", id},
                          {"title", jstr(s, "title", "新会话")},
                          {"cwd", jstr(s, "cwd")},
                          {"model", jstr(s, "model")},
                          {"mode", jstr(s, "mode", "fullAccess")},
                          {"updatedAt", s.value("updatedAt", static_cast<int64_t>(0))},
                          {"usage",
                           {{"used", jval(u, "used", json(0))},
                            {"size", jval(u, "size", json(0))},
                            {"credits", numAt(u, "credits", 0)},
                            {"charged", numAt(u, "charged", 0)}}},
                          {"messageCount", msgCount},
                          {"subagents", subagentStatsOf(s)},
                          {"workflows", workflowStatsOf(s)}});
      if (sessions.size() >= 500) break;
    }
    if (fresh_) lastId.clear();
    if (storedIsCurrent && !fresh_) lastId = storedLast;
  }
  std::string model = selectedModel();
  if (model.empty()) model = "deepseek-v4.1-flash";
  json projectNames = json::object();
  {
    json doc = readJsonFile(localAppDir() + "\\projects.json");
    json projects = jval(doc, "projects", json::object());
    if (projects.is_object()) {
      for (auto it = projects.begin(); it != projects.end(); ++it) {
        std::string name = jstr(it.value(), "name");
        if (!name.empty()) projectNames[it.key()] = name;
      }
    }
  }
  json ws = activeWorkspaceInfo();
  auto wsFolders = foldersOf(ws);
  json out = {{"demo", demo_},
              {"cwd", cw},
              {"workspace", jstr(ws, "name", leafName(cw))},
              {"workspaceId", jstr(ws, "id")},
              {"workspaceName", jstr(ws, "name", leafName(cw))},
              {"workspaceFolders", wsFolders},
              {"fresh", fresh_},
              {"port", port_},
              {"pid", GetCurrentProcessId()},
              {"agentReady", agentReady_.load()},
              {"agentError", agentError_},
              {"status", statusText()},
              {"model", model},
              {"credits", credits},
              {"charged", charged},
              {"todayCredits", todayCredits},
              {"quota", quota},
              {"sessions", sessions},
              {"projectNames", projectNames},
              {"lastSessionId", lastId},
              {"lastSeq", bus_.lastSeq()}};
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleSessions(const httplib::Request& req, httplib::Response& res) {
  if (req.method == "POST") {
    json body = json::parse(req.body, nullptr, false);
    std::string cwd = jstr(body, "cwd", currentCwd());
    json s = createSession(cwd, "");
    res.set_content(dumpJson(json{{"session", s}}), "application/json; charset=utf-8");
    return;
  }
  handleBootstrap(req, res);
}

void Backend::handleSessionDetail(const httplib::Request& req, httplib::Response& res) {
  std::string id = req.matches.size() > 1 ? req.matches[1].str() : "";
  json out;
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    json* s = findSession(id);
    if (!s) {
      res.status = 404;
      res.set_content(dumpJson(json{{"error", "会话不存在"}}), "application/json");
      return;
    }
    // 元数据按字段拷，事件单独截断：历史会话可能有几万条，全量下发会卡住前端
    out = json::object();
    for (auto it = s->begin(); it != s->end(); ++it) {
      if (it.key() == "events") continue;
      out[it.key()] = it.value();
    }
    auto evIt = s->find("events");
    if (evIt != s->end() && evIt->is_array()) {
      const json& evs = *evIt;
      size_t total = evs.size();
      size_t start = total > kSessionEventCap ? total - kSessionEventCap : 0;
      json tail = json::array();
      for (size_t i = start; i < total; ++i) tail.push_back(evs[i]);
      out["events"] = tail;
      if (start > 0) out["truncated"] = static_cast<int64_t>(start);
    } else {
      out["events"] = json::array();
    }
  }
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleDeleteSession(const httplib::Request& req, httplib::Response& res) {
  std::string id = req.matches.size() > 1 ? req.matches[1].str() : "";
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    auto& arr = store_["sessions"];
    json keep = json::array();
    for (auto& s : arr) {
      if (jstr(s, "id") != id) keep.push_back(s);
    }
    arr = keep;
    deletedIds_.insert(id);
  }
  saveStore();
  res.set_content(dumpJson(json{{"ok", true}}), "application/json");
}

void Backend::handleRename(const httplib::Request& req, httplib::Response& res) {
  std::string id = req.matches.size() > 1 ? req.matches[1].str() : "";
  json body = json::parse(req.body, nullptr, false);
  std::string title = jstr(body, "title");
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    if (json* s = findSession(id)) (*s)["title"] = title;
  }
  saveStore();
  res.set_content(dumpJson(json{{"ok", true}}), "application/json");
}

void Backend::handleChat(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (!body.is_object()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "请求体不是 JSON 对象"}}), "application/json");
    return;
  }
  std::string text = jstr(body, "text");
  json incomingImages = jval(body, "images", json::array());
  json connectors = jval(body, "connectors", json::array());
  if (text.empty() && (!incomingImages.is_array() || incomingImages.empty())) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少 text 或 images"}}), "application/json");
    return;
  }
  std::string mode = jstr(body, "mode");
  std::string model = jstr(body, "model", selectedModel());
  std::string uiId = jstr(body, "sessionId");
  json incomingConfig = jval(body, "config", json::object());

  auto mergeConfig = [&](json* s) {
    if (!s || !incomingConfig.is_object()) return;
    json cfg = jval(*s, "config", json::object());
    if (!cfg.is_object()) cfg = json::object();
    for (auto it = incomingConfig.begin(); it != incomingConfig.end(); ++it) {
      if (it.value().is_string() || it.value().is_boolean()) cfg[it.key()] = it.value();
    }
    (*s)["config"] = cfg;
  };

  json images = saveImages(incomingImages);
  if (text.empty() && images.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "图片解码失败"}}), "application/json");
    return;
  }

  bool needCreate = false;
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    json* s = uiId.empty() ? nullptr : findSession(uiId);
    if (!s) {
      needCreate = true;
    } else {
      if ((*s)["events"].empty()) {
        (*s)["title"] = text.empty() ? "图片对话" : truncateTitle(text);
      }
      if (!mode.empty()) (*s)["mode"] = mode;
      if (!model.empty()) (*s)["model"] = model;
      mergeConfig(s);
    }
  }
  if (needCreate) {
    uiId = createSession(currentCwd(), text.empty() ? "图片对话" : truncateTitle(text))["id"].get<std::string>();
    std::lock_guard<std::mutex> lk(storeMu_);
    if (json* s = findSession(uiId)) {
      if (!model.empty()) (*s)["model"] = model;
      if (!mode.empty()) (*s)["mode"] = mode;
      mergeConfig(s);
    }
  }

  // 用户气泡按原文渲染，连接器引用单独挂字段，不改写用户输入
  json userEvent = {{"text", text}};
  if (connectors.is_array() && !connectors.empty()) userEvent["connectors"] = connectors;
  if (!images.empty()) userEvent["images"] = images;
  emit(uiId, "user", userEvent);

  // 连接器是会话级 MCP 配置，这里指定只影响本轮的提示，改不了服务端注册
  std::string promptText = text;
  json promptImages = json::array();
  for (const auto& img : incomingImages) {
    if (!img.is_object()) continue;
    std::string data = jstr(img, "data");
    if (data.empty()) continue;
    promptImages.push_back({{"mime", jstr(img, "mime", "image/png")}, {"data", data}});
    if (promptImages.size() >= images.size()) break;
  }
  if (connectors.is_array() && !connectors.empty()) {
    std::string names;
    for (const auto& c : connectors) {
      if (!c.is_string()) continue;
      if (!names.empty()) names += "、";
      names += c.get<std::string>();
    }
    if (!names.empty()) {
      promptText = "请优先使用以下连接器（MCP 服务）完成这个请求：" + names + "\n\n" + text;
    }
  }

  // 多文件夹工作空间：cwd 只是第一个文件夹，其余要把绝对路径告诉模型
  {
    json ws = activeWorkspaceInfo();
    auto folders = foldersOf(ws);
    if (folders.size() > 1) {
      std::string note = "当前工作空间「" + jstr(ws, "name", leafName(folders[0])) +
                         "」包含以下文件夹（工作目录是第一个，其余需要时用绝对路径访问）：\n";
      for (size_t i = 0; i < folders.size(); ++i)
        note += std::to_string(i + 1) + ". " + folders[i] + "\n";
      note += "\n";
      promptText = note + promptText;
    }
  }

  std::thread([this, uiId, promptText, mode, model, promptImages] {
    if (demo_) runDemo(uiId, promptText);
    else runPrompt(uiId, promptText, mode, promptImages, model);
  }).detach();

  res.set_content(dumpJson(json{{"sessionId", uiId}, {"images", images}}),
                  "application/json; charset=utf-8");
}

void Backend::handlePermission(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string requestId = jstr(body, "requestId");
  std::string optionId = jstr(body, "optionId");
  bool ok = false;
  int64_t rpcId = 0;
  std::string uiId;
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    auto it = pendingPerm_.find(requestId);
    if (it != pendingPerm_.end()) {
      rpcId = it->second.first;
      uiId = it->second.second;
      pendingPerm_.erase(it);
      ok = true;
      if (demo_) permResults_[requestId] = optionId;  // 演示线程轮询取结果
    }
  }
  if (ok && !demo_ && client_) {
    client_->reply(rpcId, json{{"outcome", {{"outcome", "selected"}, {"optionId", optionId}}}});
    emit(uiId, "permission_resolved", json{{"requestId", requestId}, {"optionId", optionId}});
  }
  res.set_content(dumpJson(json{{"ok", ok}}), "application/json");
}

void Backend::handleCancel(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string uiId = jstr(body, "sessionId");
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
    auto it = uiToAcp_.find(uiId);
    if (it != uiToAcp_.end() && client_) client_->cancel(it->second);
  }
  res.set_content(dumpJson(json{{"ok", true}}), "application/json");
}

// 长轮询：有事件立刻返回，没有就最多挂 wait 毫秒再返回空数组。
// 用长轮询而不是 SSE，是为了让客户端完全掌握 from 游标，重连不会重放或丢事件。
void Backend::handleStream(const httplib::Request& req, httplib::Response& res) {
  uint64_t from = 0;
  int waitMs = 10000;
  try {
    if (req.has_param("from")) from = std::stoull(req.get_param_value("from"));
    if (req.has_param("wait")) waitMs = std::stoi(req.get_param_value("wait"));
  } catch (...) {
  }
  auto events = bus_.takeAfter(from, 200, waitMs);
  // 流式输出时事件来得又碎又密，短暂再等一小会儿把同一批合并掉，减少往返
  if (events.size() < 8 && waitMs > 0) {
    uint64_t tail = events.empty() ? from : events.back().seq;
    auto more = bus_.takeAfter(tail, 200, 120);
    events.insert(events.end(), more.begin(), more.end());
  }
  json arr = json::array();
  for (const auto& e : events) {
    // 事件级 sessionId 是权威来源，前端按它过滤；载荷里的字段可能被上游改写
    arr.push_back({{"seq", e.seq}, {"type", e.type}, {"sessionId", e.sessionId}, {"data", e.data}});
  }
  json out = {{"events", arr}, {"lastSeq", bus_.lastSeq()}};
  res.set_header("Cache-Control", "no-store");
  try {
    res.set_content(dumpJson(out), "application/json; charset=utf-8");
  } catch (const std::exception& e) {
    logf(std::string("handleStream 序列化失败: ") + e.what());
    res.status = 200;
    res.set_content("{\"events\":[],\"lastSeq\":0}", "application/json; charset=utf-8");
  }
}

void Backend::handleModels(const httplib::Request&, httplib::Response& res) {
  std::string err;
  ensureModelCatalog(err);
  json out;
  json configOptions;
  {
    std::lock_guard<std::mutex> lk(modelMu_);
    out = modelCatalog_;
    out["selected"] = selectedModel_.empty() ? jstr(modelCatalog_, "currentId") : selectedModel_;
    configOptions = configOptions_;
  }
  out["config"] = json{{"options", configOptions}};
  out["quota"] = latestQuota();
  out["demo"] = demo_;
  out["agentReady"] = agentReady_.load();
  if (!err.empty()) out["error"] = err;
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleSetModel(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string model = jstr(body, "model");
  std::string uiId = jstr(body, "sessionId");
  if (model.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少 model"}}), "application/json");
    return;
  }
  {
    std::lock_guard<std::mutex> lk(modelMu_);
    selectedModel_ = model;
    if (modelCatalog_.is_object()) modelCatalog_["currentId"] = model;
  }
  saveSetting("lastModel", model);
  bool applied = false;
  std::string error;
  std::string acpSid;
  if (!uiId.empty()) {
    std::lock_guard<std::mutex> lk(mapMu_);
    auto it = uiToAcp_.find(uiId);
    if (it != uiToAcp_.end()) acpSid = it->second;
  }
  if (!acpSid.empty() && client_) {
    try {
      json result = client_->setConfigOption(acpSid, "model", model);
      json options = jval(result, "configOptions", json::array());
      if (options.is_array() && !options.empty()) {
        std::lock_guard<std::mutex> lk(modelMu_);
        configOptions_ = options;
      }
      applied = true;
    } catch (const std::exception& e) {
      error = e.what();
      logf(std::string("handleSetModel 失败: ") + error);
    }
  }
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    if (json* s = findSession(uiId)) (*s)["model"] = model;
  }
  res.set_content(dumpJson(json{{"ok", error.empty()}, {"applied", applied}, {"model", model}, {"error", error}}),
                  "application/json; charset=utf-8");
}

void Backend::handleConfig(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (!body.is_object()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "请求体不是 JSON 对象"}}), "application/json");
    return;
  }
  std::string configId = jstr(body, "configId");
  std::string uiId = jstr(body, "sessionId");
  std::string type = jstr(body, "type");
  if (configId.empty() || !body.contains("value")) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少 configId 或 value"}}), "application/json");
    return;
  }
  json value = body["value"];
  if (!value.is_string() && !value.is_boolean()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "value 必须是字符串或布尔值"}}), "application/json");
    return;
  }
  if (type.empty()) type = value.is_boolean() ? "boolean" : "select";

  std::string acpSid;
  if (!uiId.empty()) {
    std::lock_guard<std::mutex> lk(mapMu_);
    auto it = uiToAcp_.find(uiId);
    if (it != uiToAcp_.end()) acpSid = it->second;
  }

  bool applied = false;
  std::string error;
  json options = json::array();
  if (!acpSid.empty() && client_) {
    try {
      json result = client_->setConfigOption(acpSid, configId, value, type);
      options = jval(result, "configOptions", json::array());
      if (options.is_array() && !options.empty()) {
        std::lock_guard<std::mutex> lk(modelMu_);
        configOptions_ = options;
      }
      applied = true;
    } catch (const std::exception& e) {
      error = e.what();
      logf(std::string("handleConfig 失败: ") + error);
    }
  }

  // 没有活跃 ACP 会话时也同步快照，保证 /api/models 与即将持久化的值一致
  if (error.empty() && !applied) {
    std::lock_guard<std::mutex> lk(modelMu_);
    if (configOptions_.is_array()) {
      for (auto& opt : configOptions_) {
        if (jstr(opt, "id") == configId) opt["currentValue"] = value;
      }
    }
  }

  // 失败不落盘，避免下一轮 prompt 反复重放同一个非法值。
  if (error.empty()) {
    {
      std::lock_guard<std::mutex> lk(storeMu_);
      if (json* s = findSession(uiId)) {
        json cfg = jval(*s, "config", json::object());
        if (!cfg.is_object()) cfg = json::object();
        cfg[configId] = value;
        (*s)["config"] = cfg;
        // 模型/权限模式另有独立字段，保持会话摘要同步。
        if (configId == "model" && value.is_string()) (*s)["model"] = value;
        if (configId == "mode" && value.is_string()) (*s)["mode"] = value;
      }
    }
    saveStore();
  }
  res.set_content(dumpJson(json{{"ok", error.empty()},
                                {"applied", applied},
                                {"configId", configId},
                                {"value", value},
                                {"options", options},
                                {"error", error}}),
                  "application/json; charset=utf-8");
}

void Backend::handleUsage(const httplib::Request&, httplib::Response& res) {
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(usageSummary()), "application/json; charset=utf-8");
}

void Backend::handleWorkspaces(const httplib::Request&, httplib::Response& res) {
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(workspaceList()), "application/json; charset=utf-8");
}

void Backend::handleWorkspaceOpen(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string path = jstr(body, "path");
  if (!isDirectoryPath(path)) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "目录不存在"}}), "application/json");
    return;
  }
  if (!spawnWindow(path)) {
    res.status = 500;
    res.set_content(dumpJson(json{{"error", "打开新窗口失败"}}), "application/json");
    return;
  }
  res.set_content(dumpJson(json{{"ok", true}, {"path", path}}), "application/json");
}

void Backend::handleWorkspaceUse(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string id = jstr(body, "id");
  std::string path = jstr(body, "path");

  json ws;
  if (!id.empty()) {
    ws = findWorkspace(id);
    if (ws.empty()) {
      res.status = 404;
      res.set_content(dumpJson(json{{"ok", false}, {"error", "工作空间不存在"}}),
                      "application/json; charset=utf-8");
      return;
    }
  } else {
    if (!isDirectoryPath(path)) {
      res.status = 400;
      res.set_content(dumpJson(json{{"ok", false}, {"error", "目录不存在"}}),
                      "application/json; charset=utf-8");
      return;
    }
    ws = workspaceByFolder(path);
    if (ws.empty()) {
      ws = {{"id", ""}, {"name", leafName(path)}, {"folders", json::array({path})}};
    }
  }

  activateWorkspace(ws, true, path);
  auto folders = foldersOf(ws);
  res.set_content(dumpJson(json{{"ok", true},
                                {"cwd", currentCwd()},
                                {"workspace", jstr(ws, "name", leafName(currentCwd()))},
                                {"id", jstr(ws, "id")},
                                {"folders", folders}}),
                  "application/json; charset=utf-8");
}

void Backend::handleWorkspacePick(const httplib::Request&, httplib::Response& res) {
  std::string path = pickFolder();
  res.set_content(dumpJson(json{{"path", path}}), "application/json; charset=utf-8");
}

void Backend::handleWorkspaceCreate(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string name = jstr(body, "name");
  size_t b = name.find_first_not_of(" \t\r\n");
  size_t e = name.find_last_not_of(" \t\r\n");
  name = (b == std::string::npos) ? "" : name.substr(b, e - b + 1);
  auto bad = [&](const std::string& msg) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", msg}}), "application/json; charset=utf-8");
  };
  if (name.empty()) return bad("请填写工作空间名称");
  if (name.find_first_of("\\/:*?\"<>|") != std::string::npos || name == "." || name == "..")
    return bad("名称不能包含 \\ / : * ? \" < > |");

  std::string parent = jstr(body, "parent");
  if (parent.empty()) {
    std::string home = homePath();
    if (home.empty()) return bad("无法确定默认位置，请指定父目录");
    parent = joinPathSafe(home, "WorkBuddy");
  }

  std::error_code ec;
  if (!isDirectoryPath(parent)) {
    std::filesystem::create_directories(std::filesystem::path(utf8ToWide(parent)), ec);
    if (!isDirectoryPath(parent)) return bad("父目录不可用：" + parent);
  }

  std::string path = joinPathSafe(parent, name);
  // 统一成反斜杠 + 去掉 .. 之类，界面显示和后续路径比较都省事
  {
    std::string canon = canonicalPath(path);
    if (!canon.empty()) path = canon;
  }
  bool existed = isDirectoryPath(path);
  if (!existed) {
    std::filesystem::create_directories(std::filesystem::path(utf8ToWide(path)), ec);
    if (!isDirectoryPath(path)) {
      res.status = 500;
      res.set_content(dumpJson(json{{"ok", false}, {"error", "创建目录失败：" + ec.message()}}),
                      "application/json; charset=utf-8");
      return;
    }
  }

  // 建（或复用）一个单文件夹工作空间，并切过去
  json ws = workspaceByFolder(path);
  if (ws.empty()) {
    ws = {{"id", randomId("ws_")},
          {"name", name},
          {"folders", json::array({path})},
          {"createdAt", nowMs()},
          {"updatedAt", nowMs()}};
    json doc = loadWorkspacesDoc();
    json arr = jval(doc, "workspaces", json::array());
    arr.push_back(ws);
    doc["workspaces"] = arr;
    saveWorkspacesDoc(doc);
  } else {
    existed = true;
  }

  // 侧栏按 cwd 分组，名字也从这里取
  {
    json doc = readJsonFile(projectsFilePath());
    json projects = jval(doc, "projects", json::object());
    if (!projects.is_object()) projects = json::object();
    projects[pathKey(path)] = {{"path", path}, {"name", name}, {"updatedAt", nowMs()}};
    doc["projects"] = projects;
    saveProjectsDoc(doc);
  }
  activateWorkspace(ws, true, path);
  logf("新建工作空间 " + path + (existed ? "（已存在）" : ""));
  res.set_content(dumpJson(json{{"ok", true},
                                {"path", path},
                                {"workspace", jstr(ws, "name", name)},
                                {"id", jstr(ws, "id")},
                                {"folders", foldersOf(ws)},
                                {"existed", existed}}),
                  "application/json; charset=utf-8");
}

// 新建或编辑：{id?, name, folders[]}
void Backend::handleWorkspaceSave(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  auto fail = [&](int code, const std::string& msg) {
    res.status = code;
    res.set_content(dumpJson(json{{"ok", false}, {"error", msg}}), "application/json; charset=utf-8");
  };

  std::string name = trimStr(jstr(body, "name"));
  if (name.empty()) return fail(400, "工作空间名称不能为空");
  if (name.size() > 180) return fail(400, "名称太长（最多 180 字节）");

  std::vector<std::string> folders;
  for (const auto& f : jval(body, "folders", json::array())) {
    if (!f.is_string()) continue;
    std::string p = f.get<std::string>();
    std::string canon = canonicalPath(p);
    if (!canon.empty()) p = canon;
    if (!isDirectoryPath(p)) return fail(400, "文件夹不存在：" + p);
    bool dup = false;
    for (const auto& x : folders) {
      if (pathKey(x) == pathKey(p)) {
        dup = true;
        break;
      }
    }
    if (!dup) folders.push_back(p);
  }
  if (folders.empty()) return fail(400, "至少选择一个文件夹");
  if (folders.size() > kMaxWorkspaceFolders) return fail(400, "一个工作空间最多 5 个文件夹");

  std::string id = jstr(body, "id");
  json doc = loadWorkspacesDoc();
  json arr = jval(doc, "workspaces", json::array());

  json saved;
  for (auto& w : arr) {
    if (!w.is_object()) continue;
    if (!id.empty() && jstr(w, "id") == id) {
      w["name"] = name;
      w["folders"] = folders;
      w["updatedAt"] = nowMs();
      saved = w;
      break;
    }
  }
  if (saved.empty()) {
    // 同一个主文件夹只归属一个工作空间，避免列表里出现两条一样的
    for (const auto& w : arr) {
      auto wf = foldersOf(w);
      if (!wf.empty() && pathKey(wf[0]) == pathKey(folders[0]))
        return fail(400, "这个文件夹已经属于工作空间「" + jstr(w, "name", "") + "」");
    }
    saved = {{"id", randomId("ws_")},
             {"name", name},
             {"folders", folders},
             {"createdAt", nowMs()},
             {"updatedAt", nowMs()}};
    arr.push_back(saved);
  }
  doc["workspaces"] = arr;
  if (!saveWorkspacesDoc(doc)) return fail(500, "保存工作空间失败");

  // 主文件夹的名字同步给侧栏分组
  {
    json pdoc = readJsonFile(projectsFilePath());
    json projects = jval(pdoc, "projects", json::object());
    if (!projects.is_object()) projects = json::object();
    projects[pathKey(folders[0])] = {{"path", folders[0]}, {"name", name}, {"updatedAt", nowMs()}};
    pdoc["projects"] = projects;
    saveProjectsDoc(pdoc);
  }

  // 改的正好是当前工作空间 → 立刻生效（cwd 还在列表里就保持不变）
  if (jstr(activeWorkspaceInfo(), "id") == jstr(saved, "id")) {
    activateWorkspace(saved, true, currentCwd());
  }

  if (!demo_) {
    std::lock_guard<std::mutex> lk(wsCacheMu_);
    wsCacheAt_ = 0;  // 让工作空间对话框下次重新读
  }
  res.set_content(dumpJson(json{{"ok", true}, {"workspace", saved}}),
                  "application/json; charset=utf-8");
}

void Backend::handleWorkspaceRemove(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string id = jstr(body, "id");
  if (id.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "缺少 id"}}), "application/json");
    return;
  }
  json doc = loadWorkspacesDoc();
  json arr = json::array();
  bool removed = false;
  for (const auto& w : jval(doc, "workspaces", json::array())) {
    if (jstr(w, "id") == id) {
      removed = true;
      continue;
    }
    arr.push_back(w);
  }
  if (!removed) {
    res.status = 404;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "工作空间不存在"}}), "application/json");
    return;
  }
  doc["workspaces"] = arr;
  saveWorkspacesDoc(doc);

  bool wasActive = false;
  {
    std::lock_guard<std::mutex> lk(wsMu_);
    if (jstr(activeWorkspace_, "id") == id) {
      activeWorkspace_ = json::object();
      wasActive = true;
    }
  }
  if (wasActive) {
    // 只删掉分组，不删文件夹；当前 cwd 保持原样
    saveSetting("lastWorkspaceId", "");
  }
  res.set_content(dumpJson(json{{"ok", true}}), "application/json; charset=utf-8");
}

void Backend::handleTree(const httplib::Request& req, httplib::Response& res) {
  std::string path = req.has_param("path") ? req.get_param_value("path") : "";
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(json{{"entries", workspaceTree(path)}}), "application/json; charset=utf-8");
}

void Backend::handleGit(const httplib::Request&, httplib::Response& res) {
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(gitOverview()), "application/json; charset=utf-8");
}

void Backend::handleGitDiff(const httplib::Request& req, httplib::Response& res) {
  std::string path = req.get_param_value("path");
  bool staged = req.get_param_value("staged") == "1";
  if (path.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少 path"}}), "application/json");
    return;
  }
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(gitDiff(path, staged)), "application/json; charset=utf-8");
}

void Backend::handleGitAction(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string action = jstr(body, "action");
  std::string folder = jstr(body, "folder");
  std::string message = jstr(body, "message");
  std::vector<std::string> paths;
  for (const auto& p : jval(body, "paths", json::array())) {
    if (p.is_string()) paths.push_back(p.get<std::string>());
  }
  json out = gitAction(action, folder, paths, message);
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::setBrowserHooks(std::function<std::string(const std::string&)> eval,
                              std::function<void(const std::string&)> navigate,
                              std::function<std::string()> state,
                              std::function<std::string(const std::string&)> shot,
                              std::function<std::string()> importCookies) {
  browserEval_ = std::move(eval);
  browserNavigate_ = std::move(navigate);
  browserState_ = std::move(state);
  browserShot_ = std::move(shot);
  browserImportCookies_ = std::move(importCookies);
}

void Backend::setExitHook(std::function<void()> hook) {
  std::lock_guard<std::mutex> lk(exitMu_);
  exitHook_ = std::move(hook);
}

namespace {

// 默认取 exe 同级的 workbuddy-lite.next.exe；显式传路径时先按工作目录、再按 exe 目录解析
std::string resolveNextPath(const std::string& requested) {
  if (requested.empty()) return exeDir() + "\\workbuddy-lite.next.exe";
  if (requested.size() > 1 && requested[1] == ':') return requested;
  if (requested.rfind("\\\\", 0) == 0) return requested;
  char cwd[MAX_PATH] = {0};
  GetCurrentDirectoryA(MAX_PATH, cwd);
  std::string byCwd = std::string(cwd) + "\\" + requested;
  if (isFilePath(byCwd)) return byCwd;
  std::string byExe = exeDir() + "\\" + requested;
  if (isFilePath(byExe)) return byExe;
  return byCwd;
}

std::string selfExePath() {
  wchar_t buf[MAX_PATH] = {0};
  GetModuleFileNameW(nullptr, buf, MAX_PATH);
  return wideToUtf8(buf);
}

std::string uiStatePath() { return localAppDir() + "\\ui-state.json"; }

}  // namespace

void Backend::handleAppUpdate(const httplib::Request&, httplib::Response& res) {
  const std::string next = resolveNextPath("");
  const std::string updater = exeDir() + "\\workbuddy-updater.exe";
  json out = {{"updateReady", isFilePath(next)},
              {"next", next},
              {"updater", updater},
              {"updaterReady", isFilePath(updater)},
              {"restarting", restarting_.load()},
              {"target", selfExePath()}};
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleAppRestart(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (!body.is_object()) body = json::object();

  if (restarting_.exchange(true)) {
    res.status = 409;
    res.set_content(dumpJson(json{{"error", "已经在重启流程中"}}), "application/json; charset=utf-8");
    return;
  }

  auto fail = [&](int status, const std::string& message) {
    restarting_ = false;
    res.status = status;
    res.set_content(dumpJson(json{{"ok", false}, {"error", message}}), "application/json; charset=utf-8");
  };

  // 会话/配置先落盘：sessions.json 里的 lastSessionId、会话 config 与 usage 都已由各自路径写过
  saveStore();

  const std::string next = resolveNextPath(jstr(body, "next"));
  if (_stricmp(leafName(next).c_str(), "workbuddy-lite.next.exe") != 0) {
    fail(400, "next 只接受 workbuddy-lite.next.exe：" + next);
    return;
  }
  if (!isFilePath(next)) {
    fail(409, "没有可应用的更新：" + next + " 不存在");
    return;
  }
  const std::string updater = exeDir() + "\\workbuddy-updater.exe";
  if (!isFilePath(updater)) {
    fail(500, "缺少更新器：" + updater + "，先运行 build-updater.bat");
    return;
  }

  // updater 要从 %TEMP% 的副本跑：它所在的 bin 目录马上会被替换
  wchar_t tempDir[MAX_PATH] = {0};
  GetTempPathW(MAX_PATH, tempDir);
  const std::wstring copy = std::wstring(tempDir) + L"workbuddy-updater-" +
                            std::to_wstring(GetCurrentProcessId()) + L"-" +
                            std::to_wstring(GetTickCount64()) + L".exe";
  if (!CopyFileW(utf8ToWide(updater).c_str(), copy.c_str(), FALSE)) {
    fail(500, "复制更新器到临时目录失败，错误码 " + std::to_string(GetLastError()));
    return;
  }

  std::wstring appArgs;
  {
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (argv) {
      for (int i = 1; i < argc; ++i) {
        appArgs += L" ";
        appArgs += quoteArg(argv[i]);
      }
      LocalFree(argv);
    }
  }

  const std::wstring target = utf8ToWide(selfExePath());
  std::wstring cmd = quoteArg(copy) + L" --pid " + std::to_wstring(GetCurrentProcessId()) +
                     L" --next " + quoteArg(utf8ToWide(next)) + L" --target " + quoteArg(target) +
                     L" --timeout 30 --" + appArgs;

  wchar_t cwd[MAX_PATH] = {0};
  GetCurrentDirectoryW(MAX_PATH, cwd);
  STARTUPINFOW si{};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi{};
  std::vector<wchar_t> buf(cmd.begin(), cmd.end());
  buf.push_back(L'\0');
  if (!CreateProcessW(copy.c_str(), buf.data(), nullptr, nullptr, FALSE,
                      DETACHED_PROCESS | CREATE_UNICODE_ENVIRONMENT, nullptr, cwd, &si, &pi)) {
    fail(500, "启动更新器失败，错误码 " + std::to_string(GetLastError()));
    return;
  }
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  logf("自更新：已启动 " + wideToUtf8(copy) + " next=" + next + " target=" + wideToUtf8(target));

  res.status = 202;
  res.set_content(dumpJson(json{{"ok", true},
                                {"pid", GetCurrentProcessId()},
                                {"next", next},
                                {"updater", wideToUtf8(copy)}}),
                  "application/json; charset=utf-8");

  // 让 HTTP 响应先发出去，再走正常关窗路径（WebView2 + codebuddy 子进程一起收尾）
  std::thread([this] {
    Sleep(600);
    std::function<void()> hook;
    {
      std::lock_guard<std::mutex> lk(exitMu_);
      hook = exitHook_;
    }
    if (hook) {
      hook();
    } else {
      logf("自更新：没有退出钩子，无法自动关闭窗口");
    }
  }).detach();
}

void Backend::handleUiStateGet(const httplib::Request&, httplib::Response& res) {
  json doc = readJsonFile(uiStatePath());
  if (!doc.is_object()) doc = json::object();
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(doc), "application/json; charset=utf-8");
}

void Backend::handleUiStateSet(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (!body.is_object()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "请求体不是 JSON 对象"}}), "application/json; charset=utf-8");
    return;
  }

  // 读改写放进同一把命名互斥量：未读游标（teamRead）也写在同一个文件里，
  // 两边各读一遍再各写一遍会互相覆盖。
  mutateUiStateDoc([&](json& doc) {
    for (const char* key : {"activeSessionId", "activeChannelId", "chat", "workbench"}) {
      if (body.contains(key)) doc[key] = body[key];
    }
  });
  bool ok = true;

  // activeSessionId 同时写回 sessions.json 的 lastSessionId，bootstrap 直接就能用
  if (body.contains("activeSessionId") && body["activeSessionId"].is_string()) {
    const std::string sid = body["activeSessionId"].get<std::string>();
    bool changed = false;
    {
      std::lock_guard<std::mutex> lk(storeMu_);
      if (jstr(store_, "lastSessionId") != sid) {
        store_["lastSessionId"] = sid;
        changed = true;
      }
    }
    if (changed) saveStore();
  }

  res.set_content(dumpJson(json{{"ok", ok}}), "application/json; charset=utf-8");
}

void Backend::handleBrowserState(const httplib::Request&, httplib::Response& res) {
  json state = json::object();
  if (browserState_) {
    std::string raw = browserState_();
    json parsed = json::parse(raw, nullptr, false);
    if (!parsed.is_discarded() && parsed.is_object()) state = parsed;
  }
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(json{{"ok", true}, {"state", state}}), "application/json; charset=utf-8");
}

void Backend::handleBrowserNavigate(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string url = jstr(body, "url");
  if (url.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "缺少 url"}}), "application/json");
    return;
  }
  if (browserNavigate_) browserNavigate_(url);
  res.set_content(dumpJson(json{{"ok", true}, {"url", url}}), "application/json; charset=utf-8");
}

void Backend::handleBrowserEval(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string script = jstr(body, "script");
  if (script.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "缺少 script"}}), "application/json");
    return;
  }
  if (script.size() > 200 * 1024) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "script 太长"}}), "application/json");
    return;
  }
  std::string raw = browserEval_ ? browserEval_(script) : "";
  json value = json::parse(raw, nullptr, false);
  if (value.is_discarded()) value = nullptr;
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(json{{"ok", true}, {"result", value}}), "application/json; charset=utf-8");
}

void Backend::handleBrowserShot(const httplib::Request& req, httplib::Response& res) {
  std::string path = req.get_param_value("path");
  if (path.empty()) {
    std::string dir = localAppDir() + "\\shots";
    std::error_code ec;
    std::filesystem::create_directories(std::filesystem::path(utf8ToWide(dir)), ec);
    path = dir + "\\shot-" + std::to_string(nowMs()) + ".png";
  }
  std::string err;
  if (browserShot_) err = browserShot_(path);
  if (!err.empty()) {
    res.status = 500;
    res.set_content(dumpJson(json{{"ok", false}, {"error", err}}), "application/json; charset=utf-8");
    return;
  }
  res.set_content(dumpJson(json{{"ok", true}, {"path", path}}), "application/json; charset=utf-8");
}

void Backend::handleBrowserImport(const httplib::Request&, httplib::Response& res) {
  std::string raw = browserImportCookies_ ? browserImportCookies_() : "";
  json out = json::parse(raw, nullptr, false);
  if (out.is_discarded() || !out.is_object()) {
    out = json{{"ok", false}, {"error", "导入失败：浏览器面板还没打开"}};
  }
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

// 一个会话里跑了多少子智能体、几个还在跑、一共多少步
namespace {
json subagentStatsOf(const json& session) {
  json out = {{"count", 0}, {"running", 0}, {"steps", 0}, {"types", json::array()}};
  auto eventsIt = session.find("events");
  if (eventsIt == session.end() || !eventsIt->is_array()) return out;

  std::map<std::string, std::string> status;  // parentId -> 最后状态
  std::map<std::string, int> steps;
  std::map<std::string, bool> parents;
  std::set<std::string> types;

  for (const auto& event : *eventsIt) {
    if (!event.is_object()) continue;
    const json& data = event.contains("data") ? event["data"] : json::object();
    std::string type = jstr(event, "type");
    std::string id = jstr(data, "id");
    if (type == "tool" && (data.value("isSubagent", false) || !jstr(data, "subagentType").empty())) {
      if (!id.empty()) {
        parents[id] = true;
        status[id] = jstr(data, "status", "in_progress");
        std::string stype = jstr(data, "subagentType");
        if (!stype.empty()) types.insert(stype);
      }
    }
    std::string parent = jstr(data, "parentToolCallId");
    if (!parent.empty()) {
      parents[parent] = true;
      if (type == "tool" || type == "tool_update") steps[parent]++;
      if (type == "tool_update") {
        std::string s = jstr(data, "status");
        if (!s.empty()) status[parent] = s;
      }
    }
  }

  int running = 0;
  int totalSteps = 0;
  for (const auto& entry : parents) {
    std::string s = status[entry.first];
    if (s == "in_progress" || s == "running" || s == "pending") running++;
  }
  for (const auto& entry : steps) totalSteps += entry.second;

  out["count"] = static_cast<int>(parents.size());
  out["running"] = running;
  out["steps"] = totalSteps;
  for (const auto& t : types) out["types"].push_back(t);
  return out;
}

// 会话里跑过的工作流：名称、状态、完成/总数、当前阶段
json workflowStatsOf(const json& session) {
  json out = {{"name", ""},
              {"status", ""},
              {"done", 0},
              {"total", 0},
              {"running", 0},
              {"phase", ""},
              {"cached", 0},
              {"phases", 0}};
  auto eventsIt = session.find("events");
  if (eventsIt == session.end() || !eventsIt->is_array()) return out;

  std::string runId;
  std::map<std::string, std::string> agents;
  for (const auto& event : *eventsIt) {
    if (!event.is_object() || jstr(event, "type") != "workflow") continue;
    const json& data = event.contains("data") ? event["data"] : json::object();
    std::string id = jstr(data, "runId");
    if (runId.empty()) runId = id;
    if (!id.empty() && id != runId) continue;  // 只看最后一次

    std::string kind = jstr(data, "kind");
    if (kind == "workflow_run_started" || kind == "workflow_run_finished") {
      std::string name = jstr(data, "name");
      if (!name.empty()) out["name"] = name;
      std::string status = jstr(data, "status");
      if (!status.empty()) out["status"] = status;
      int total = static_cast<int>(numAt(data, "agentCount", 0));
      if (total > 0) out["total"] = total;
      out["cached"] = static_cast<int>(numAt(data, "cachedCount", 0));
      out["phases"] = static_cast<int>(numAt(data, "phaseCount", 0));
      if (data.contains("error")) out["error"] = data["error"];
    } else if (kind == "workflow_phase_started" || kind == "workflow_phase_finished") {
      std::string phase = jstr(data, "phase");
      if (!phase.empty()) out["phase"] = phase;
    } else if (kind.rfind("workflow_agent_", 0) == 0) {
      std::string key = jstr(data, "agentKey");
      if (key.empty()) continue;
      std::string status = "completed";
      if (kind == "workflow_agent_started") status = "running";
      if (kind == "workflow_agent_cached") status = "cached";
      if (data.contains("agentError")) status = "failed";
      agents[key] = status;
    }
  }

  int done = 0;
  int running = 0;
  for (const auto& entry : agents) {
    if (entry.second == "completed" || entry.second == "cached") done++;
    else if (entry.second == "running") running++;
  }
  out["done"] = done;
  out["running"] = running;
  if (out.value("total", 0) == 0) out["total"] = static_cast<int>(agents.size());
  return out;
}
}  // namespace

json Backend::renameWorkspaceByFolder(const std::string& path, const std::string& name) {
  if (path.empty() || name.empty()) return json::object();
  std::string key = pathKey(path);
  json doc = loadWorkspacesDoc();
  json arr = jval(doc, "workspaces", json::array());
  json updated;
  for (auto& w : arr) {
    if (!w.is_object()) continue;
    auto folders = foldersOf(w);
    if (folders.empty() || pathKey(folders[0]) != key) continue;
    w["name"] = name;
    w["updatedAt"] = nowMs();
    updated = w;
    break;
  }
  if (updated.empty()) return updated;
  doc["workspaces"] = arr;
  saveWorkspacesDoc(doc);
  if (jstr(activeWorkspaceInfo(), "id") == jstr(updated, "id")) {
    std::lock_guard<std::mutex> lk(wsMu_);
    activeWorkspace_ = updated;
  }
  return updated;
}

bool Backend::pathInWorkspace(const std::string& path) const {
  auto folders = foldersOf(activeWorkspaceInfo());
  for (const auto& folder : folders) {
    if (isPathInside(folder, path)) return true;
  }
  return false;
}

json Backend::workspaceTree(const std::string& path) {
  if (path.empty()) {
    // 根节点就是工作空间的文件夹
    json out = json::array();
    for (const auto& folder : foldersOf(activeWorkspaceInfo())) {
      out.push_back({{"name", leafName(folder)}, {"path", folder}, {"isDir", true}, {"root", true}});
    }
    return out;
  }
  if (!pathInWorkspace(path)) return json::array();
  return listDirEntries(path);
}

json Backend::gitOverview() {
  const int64_t now = nowMs();
  {
    std::lock_guard<std::mutex> lk(gitMu_);
    if (!gitCache_.empty() && now - gitCacheAt_ < 3000) return gitCache_;
  }

  json folders = json::array();
  int changed = 0, staged = 0, untracked = 0;
  for (const auto& folder : foldersOf(activeWorkspaceInfo())) {
    json s = gitStatusFor(folder);
    if (s.value("isRepo", false)) {
      for (const auto& file : jval(s, "files", json::array())) {
        ++changed;
        if (file.value("staged", false)) ++staged;
        if (file.value("untracked", false)) ++untracked;
      }
    }
    folders.push_back(s);
  }
  json out = {{"folders", folders}, {"changed", changed}, {"staged", staged}, {"untracked", untracked}};
  {
    std::lock_guard<std::mutex> lk(gitMu_);
    gitCache_ = out;
    gitCacheAt_ = now;
  }
  return out;
}

json Backend::gitDiff(const std::string& absPath, bool staged) {
  std::string folder;
  for (const auto& f : foldersOf(activeWorkspaceInfo())) {
    if (isPathInside(f, absPath)) {
      folder = f;
      break;
    }
  }
  if (folder.empty()) return json{{"error", "文件不在工作空间里"}};

  std::string rel = absPath;
  if (rel.size() > folder.size()) rel = rel.substr(folder.size());
  while (!rel.empty() && (rel[0] == '\\' || rel[0] == '/')) rel.erase(0, 1);

  json out = {{"path", absPath}, {"folder", folder}, {"staged", staged}, {"diff", ""}};
  if (!isGitRepo(folder)) {
    out["error"] = "这个文件夹不是 git 仓库";
    return out;
  }

  std::vector<std::string> args = {"git", "-C", folder, "diff", "--no-color"};
  if (staged) args.push_back("--cached");
  args.push_back("--");
  args.push_back(rel);
  auto r = runCapture(args, folder, 15000);
  if (r.ok && !r.out.empty()) {
    out["diff"] = r.out.size() > 800 * 1024 ? r.out.substr(0, 800 * 1024) : r.out;
    return out;
  }

  // 未跟踪文件 git diff 是空的，这里造一份「全新增」的 diff
  std::error_code ec;
  std::filesystem::path p(utf8ToWide(absPath));
  if (std::filesystem::is_regular_file(p, ec)) {
    auto size = std::filesystem::file_size(p, ec);
    if (!ec && size < 512 * 1024) {
      std::ifstream in(p.wstring().c_str(), std::ios::binary);
      std::stringstream ss;
      ss << in.rdbuf();
      std::string body = ss.str();
      std::string diff = "diff --git a/" + rel + " b/" + rel + "\nnew file\n--- /dev/null\n+++ b/" + rel + "\n";
      std::istringstream lines(body);
      std::string line;
      int count = 0;
      while (std::getline(lines, line) && count < 4000) {
        diff += "+" + line + "\n";
        ++count;
      }
      out["diff"] = diff;
      out["untracked"] = true;
    } else {
      out["binary"] = true;
    }
  }
  return out;
}

json Backend::gitAction(const std::string& action, const std::string& folder,
                        const std::vector<std::string>& paths, const std::string& message) {
  if (folder.empty() || !pathInWorkspace(folder)) return json{{"ok", false}, {"error", "文件夹不在工作空间里"}};
  if (!isGitRepo(folder)) return json{{"ok", false}, {"error", "不是 git 仓库"}};

  auto relOf = [&](const std::string& abs) {
    std::string rel = abs;
    if (rel.size() > folder.size()) rel = rel.substr(folder.size());
    while (!rel.empty() && (rel[0] == '\\' || rel[0] == '/')) rel.erase(0, 1);
    return rel;
  };

  CmdResult r;
  if (action == "stage" || action == "unstage") {
    std::vector<std::string> args = {"git", "-C", folder};
    if (action == "stage") {
      args.push_back("add");
      args.push_back("-A");
    } else {
      args.push_back("restore");
      args.push_back("--staged");
    }
    args.push_back("--");
    if (paths.empty()) {
      args.push_back(".");
    } else {
      for (const auto& p : paths) args.push_back(relOf(p));
    }
    r = runCapture(args, folder, 20000);
  } else if (action == "commit") {
    std::string msg = trimStr(message);
    if (msg.empty()) return json{{"ok", false}, {"error", "提交信息不能为空"}};
    r = runCapture({"git", "-C", folder, "commit", "-m", msg}, folder, 30000);
  } else {
    return json{{"ok", false}, {"error", "未知操作"}};
  }

  {
    std::lock_guard<std::mutex> lk(gitMu_);
    gitCacheAt_ = 0;
  }
  std::string output = trimStr(r.out);
  if (output.size() > 4000) output = output.substr(output.size() - 4000);
  return json{{"ok", r.ok}, {"output", output}, {"error", r.ok ? "" : output}};
}

void Backend::handleFile(const httplib::Request& req, httplib::Response& res) {
  std::string raw = req.get_param_value("path");
  if (raw.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少 path"}}), "application/json");
    return;
  }
  // 兼容 file:///C:/... 这种 URI
  if (raw.rfind("file://", 0) == 0) {
    raw = raw.substr(7);
    if (!raw.empty() && raw[0] == '/') raw.erase(0, 1);
  }
  const std::string cwd = currentCwd();
  std::filesystem::path candidate(utf8ToWide(raw));
  if (candidate.is_relative()) candidate = std::filesystem::path(utf8ToWide(cwd)) / candidate;
  std::string full = wideToUtf8(candidate.wstring());

  bool inside = false;
  for (const auto& folder : foldersOf(activeWorkspaceInfo())) {
    if (isPathInside(folder, full)) {
      inside = true;
      break;
    }
  }
  if (!inside) {
    res.status = 403;
    res.set_content(dumpJson(json{{"error", "只能读取当前工作空间内的文件"}}), "application/json");
    return;
  }
  if (!isFilePath(full)) {
    res.status = 404;
    res.set_content(dumpJson(json{{"error", "文件不存在"}}), "application/json");
    return;
  }
  res.set_header("Cache-Control", "no-store");
  res.set_header("Accept-Ranges", "bytes");
  res.set_header("Content-Disposition", "inline");
  res.set_file_content(full, contentTypeFor(full));
}

void Backend::handleIuiGet(const httplib::Request&, httplib::Response& res) {
  json doc = readJsonFile(localAppDir() + "\\intelligent-ui.json");
  json out = {{"templates", jval(doc, "templates", json::array())},
              {"saved", jval(doc, "saved", json::array())},
              {"defaultTemplateId", jstr(doc, "defaultTemplateId")}};
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleIuiSet(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (!body.is_object()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "请求体不是 JSON 对象"}}), "application/json");
    return;
  }
  json doc = {{"templates", jval(body, "templates", json::array())},
              {"saved", jval(body, "saved", json::array())},
              {"defaultTemplateId", jstr(body, "defaultTemplateId")}};
  std::string path = localAppDir() + "\\intelligent-ui.json";
  std::string tmp = path + ".tmp";

  HANDLE mtx = CreateMutexA(nullptr, FALSE, "Local\\WorkBuddyLiteIui");
  if (mtx) WaitForSingleObject(mtx, 5000);
  std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
  bool ok = false;
  if (out) {
    out << dumpJson(doc);
    out.close();
    ok = MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING) != 0;
  }
  if (mtx) {
    ReleaseMutex(mtx);
    CloseHandle(mtx);
  }
  res.set_content(dumpJson(json{{"ok", ok}}), "application/json; charset=utf-8");
}

void Backend::handleProjectRename(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string path = jstr(body, "path");
  std::string name = jstr(body, "name");
  if (path.empty() || name.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少 path 或 name"}}), "application/json");
    return;
  }
  json doc = readJsonFile(projectsFilePath());
  json projects = jval(doc, "projects", json::object());
  if (!projects.is_object()) projects = json::object();
  projects[pathKey(path)] = {{"path", path}, {"name", name}, {"updatedAt", nowMs()}};
  doc["projects"] = projects;
  saveProjectsDoc(doc);
  renameWorkspaceByFolder(path, name);
  res.set_content(dumpJson(json{{"ok", true}}), "application/json");
}

void Backend::handleProjectApply(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  json incomingProjects = jval(body, "projects", json::array());
  json incomingSessions = jval(body, "sessions", json::array());

  int projectCount = 0;
  int sessionCount = 0;
  if (incomingProjects.is_array() && !incomingProjects.empty()) {
    json doc = readJsonFile(projectsFilePath());
    json projects = jval(doc, "projects", json::object());
    if (!projects.is_object()) projects = json::object();
    for (const auto& p : incomingProjects) {
      std::string path = jstr(p, "path", jstr(p, "cwd"));
      std::string name = jstr(p, "name");
      if (path.empty() || name.empty()) continue;
      projects[pathKey(path)] = {{"path", path}, {"name", name}, {"updatedAt", nowMs()}};
      ++projectCount;
    }
    doc["projects"] = projects;
    saveProjectsDoc(doc);
    for (const auto& p : incomingProjects) {
      std::string path = jstr(p, "path", jstr(p, "cwd"));
      std::string name = jstr(p, "name");
      if (!path.empty() && !name.empty()) renameWorkspaceByFolder(path, name);
    }
  }

  if (incomingSessions.is_array() && !incomingSessions.empty()) {
    {
      std::lock_guard<std::mutex> lk(storeMu_);
      for (const auto& item : incomingSessions) {
        std::string id = jstr(item, "id");
        std::string title = jstr(item, "title");
        if (id.empty() || title.empty()) continue;
        if (json* s = findSession(id)) {
          (*s)["title"] = utf8Truncate(title, 160);
          (*s)["updatedAt"] = nowMs();
          ++sessionCount;
        }
      }
    }
    saveStore();
  }
  res.set_content(dumpJson(json{{"ok", true}, {"projects", projectCount}, {"sessions", sessionCount}}),
                  "application/json");
}

void Backend::handleAiOrganize(const httplib::Request&, httplib::Response& res) {
  if (demo_) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "演示模式没有模型，不能做 AI 整理"}}), "application/json");
    return;
  }

  json items = json::array();
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    const auto& all = jval(store_, "sessions", json::array());
    int count = 0;
    for (auto it = all.rbegin(); it != all.rend() && count < 80; ++it) {
      const json& s = *it;
      std::string id = jstr(s, "id");
      std::string cwd = jstr(s, "cwd");
      if (id.empty() || cwd.empty()) continue;
      std::string firstUser, lastUser;
      auto evIt = s.find("events");
      int64_t eventCount = 0;
      if (evIt != s.end() && evIt->is_array()) {
        eventCount = static_cast<int64_t>(evIt->size());
        for (const auto& ev : *evIt) {
          if (jstr(ev, "type") != "user") continue;
          std::string text = jstr(jval(ev, "data", json::object()), "text");
          if (text.empty()) continue;
          if (firstUser.empty()) firstUser = text;
          lastUser = text;
        }
      }
      items.push_back({{"id", id},
                       {"title", jstr(s, "title", "新会话")},
                       {"cwd", cwd},
                       {"count", eventCount},
                       {"firstUser", utf8Truncate(firstUser, 120)},
                       {"lastUser", utf8Truncate(lastUser, 120)}});
      ++count;
    }
  }
  if (items.empty()) {
    res.set_content(dumpJson(json{{"ok", false}, {"error", "还没有会话可整理"}}), "application/json");
    return;
  }

  json doc = readJsonFile(projectsFilePath());
  json projects = jval(doc, "projects", json::object());
  if (!projects.is_object()) projects = json::object();
  json names = json::object();
  for (auto it = projects.begin(); it != projects.end(); ++it) {
    std::string name = jstr(it.value(), "name");
    if (!name.empty()) names[it.key()] = name;
  }

  std::string prompt =
      "你是 WorkBuddy 的会话整理助手。请根据会话内容，给项目起更清晰的名字，并给会话起具体标题。\n"
      "只输出一个 JSON 对象，不要输出 Markdown、不要解释、不要调用任何工具。\n"
      "输出格式：{\"projects\":[{\"cwd\":\"...\",\"name\":\"2-8字项目名\"}],"
      "\"sessions\":[{\"id\":\"s_...\",\"title\":\"不超过18字的会话标题\"}]}\n"
      "规则：项目名要体现项目主题，不要用日期或路径；会话标题要具体，能一眼看出做了什么；"
      "不要用“新会话”“你好”这类空标题；只处理给出的会话，不要编造 id；已经很好的标题可以不返回。\n";
  prompt += "已有项目名：" + dumpJson(names) + "\n";
  prompt += "会话列表：" + dumpJson(items);

  std::string err;
  std::string text = runOrganizerPrompt(prompt, err);
  if (!err.empty()) {
    res.status = 500;
    res.set_content(dumpJson(json{{"ok", false}, {"error", err}}), "application/json");
    return;
  }
  json parsed = extractJsonObject(text);
  if (parsed.empty()) {
    res.set_content(dumpJson(json{{"ok", false},
                                 {"error", "模型没有返回可解析的 JSON"},
                                 {"raw", utf8Truncate(text, 800)}}),
                    "application/json");
    return;
  }

  json outProjects = json::array();
  for (const auto& p : jval(parsed, "projects", json::array())) {
    std::string cwd = jstr(p, "cwd");
    std::string name = jstr(p, "name");
    if (cwd.empty() || name.empty()) continue;
    outProjects.push_back({{"cwd", cwd}, {"name", utf8Truncate(name, 60)}});
    if (outProjects.size() >= 100) break;
  }
  json outSessions = json::array();
  for (const auto& s : jval(parsed, "sessions", json::array())) {
    std::string id = jstr(s, "id");
    std::string title = jstr(s, "title");
    if (id.empty() || title.empty()) continue;
    outSessions.push_back({{"id", id}, {"title", utf8Truncate(title, 60)}});
    if (outSessions.size() >= 300) break;
  }
  res.set_content(dumpJson(json{{"ok", true}, {"projects", outProjects}, {"sessions", outSessions}}),
                  "application/json");
}

void Backend::handleStatic(const httplib::Request& req, httplib::Response& res) {
  std::string path = req.path;
  if (path == "/" || path.empty()) path = "/index.html";
  if (path.find("..") != std::string::npos) {
    res.status = 400;
    return;
  }
  std::string full = webRoot_ + path;
  for (auto& c : full)
    if (c == '/') c = '\\';
  std::ifstream in(full, std::ios::binary);
  if (!in) {
    res.status = 404;
    res.set_content("找不到 " + path + "，请确认 web 目录与 exe 同级。", "text/plain; charset=utf-8");
    return;
  }
  std::stringstream ss;
  ss << in.rdbuf();
  // /assets/ 下是带 hash 的构建产物，可以长期缓存；其余保持 no-store，改完立刻能看到
  if (path.rfind("/assets/", 0) == 0) {
    res.set_header("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.set_header("Cache-Control", "no-store");
  }
  res.set_content(ss.str(), contentTypeFor(path));
}

void Backend::setupRoutes() {
  srv_.Get("/api/ping", [](const httplib::Request& req, httplib::Response& res) {
    logf("[ping] " + req.get_param_value("from"));
    res.set_content("{\"ok\":true}", "application/json");
  });
  srv_.Get("/api/bootstrap", [this](const auto& r, auto& s) { handleBootstrap(r, s); });
  srv_.Get("/api/app/update", [this](const auto& r, auto& s) { handleAppUpdate(r, s); });
  srv_.Post("/api/app/restart", [this](const auto& r, auto& s) { handleAppRestart(r, s); });
  srv_.Get("/api/app/ui", [this](const auto& r, auto& s) { handleUiStateGet(r, s); });
  srv_.Post("/api/app/ui", [this](const auto& r, auto& s) { handleUiStateSet(r, s); });
  srv_.Post("/api/sessions", [this](const auto& r, auto& s) { handleSessions(r, s); });
  srv_.Get("/api/sessions", [this](const auto& r, auto& s) { handleBootstrap(r, s); });
  srv_.Get(R"(/api/sessions/([A-Za-z0-9_\-]+))",
           [this](const auto& r, auto& s) { handleSessionDetail(r, s); });
  srv_.Delete(R"(/api/sessions/([A-Za-z0-9_\-]+))",
              [this](const auto& r, auto& s) { handleDeleteSession(r, s); });
  srv_.Post(R"(/api/sessions/([A-Za-z0-9_\-]+)/rename)",
            [this](const auto& r, auto& s) { handleRename(r, s); });
  srv_.Post("/api/chat", [this](const auto& r, auto& s) { handleChat(r, s); });
  srv_.Post("/api/log", [](const httplib::Request& req, httplib::Response& res) {
    logf("[page] " + req.body.substr(0, 500));
    res.set_content("{}", "application/json");
  });
  srv_.Post("/api/permission", [this](const auto& r, auto& s) { handlePermission(r, s); });
  srv_.Post("/api/cancel", [this](const auto& r, auto& s) { handleCancel(r, s); });
  srv_.Get("/api/events", [this](const auto& r, auto& s) { handleStream(r, s); });
  // 群聊 bot：全部是毫秒级 HTTP 代理，不走 job；events 是长轮询，只回增量消息
  srv_.Get("/api/team/state", [this](const auto& r, auto& s) { handleTeamState(r, s); });
  srv_.Get("/api/team/unread", [this](const auto& r, auto& s) { handleTeamUnread(r, s); });
  srv_.Post("/api/team/read", [this](const auto& r, auto& s) { handleTeamRead(r, s); });
  srv_.Post("/api/team/channel", [this](const auto& r, auto& s) { handleTeamCreate(r, s); });
  srv_.Get("/api/team/messages", [this](const auto& r, auto& s) { handleTeamMessages(r, s); });
  srv_.Post("/api/team/send", [this](const auto& r, auto& s) { handleTeamSend(r, s); });
  srv_.Get("/api/team/events", [this](const auto& r, auto& s) { handleTeamEvents(r, s); });
  srv_.Post("/api/team/member", [this](const auto& r, auto& s) { handleTeamMember(r, s); });
  srv_.Post("/api/team/member/restart", [this](const auto& r, auto& s) { handleTeamRestart(r, s); });
  // v2 成员/人设写操作：PATCH 与 POST 同义，前端统一用 PATCH；POST 留作兼容
  srv_.Patch("/api/team/channel/members", [this](const auto& r, auto& s) { handleTeamMembers(r, s); });
  srv_.Post("/api/team/channel/members", [this](const auto& r, auto& s) { handleTeamMembers(r, s); });
  srv_.Post("/api/team/channel/lead", [this](const auto& r, auto& s) { handleTeamLead(r, s); });
  srv_.Get("/api/team/agent", [this](const auto& r, auto& s) { handleTeamAgentGet(r, s); });
  srv_.Post("/api/team/agent", [this](const auto& r, auto& s) { handleTeamAgentCreate(r, s); });
  srv_.Patch("/api/team/agent", [this](const auto& r, auto& s) { handleTeamAgentUpdate(r, s); });
  srv_.Get("/api/catalog", [this](const auto& r, auto& s) { handleCatalog(r, s); });
  srv_.Get("/api/market/overview", [this](const auto& r, auto& s) { handleMarketOverview(r, s); });
  srv_.Post("/api/market/parse", [this](const auto& r, auto& s) { handleMarketParse(r, s); });
  srv_.Post("/api/market/install", [this](const auto& r, auto& s) { handleMarketInstall(r, s); });
  srv_.Post("/api/market/uninstall", [this](const auto& r, auto& s) { handleMarketUninstall(r, s); });
  srv_.Get("/api/market/job", [this](const auto& r, auto& s) { handleMarketJob(r, s); });
  srv_.Get("/api/models", [this](const auto& r, auto& s) { handleModels(r, s); });
  srv_.Post("/api/model", [this](const auto& r, auto& s) { handleSetModel(r, s); });
  srv_.Post("/api/config", [this](const auto& r, auto& s) { handleConfig(r, s); });
  srv_.Get("/api/usage", [this](const auto& r, auto& s) { handleUsage(r, s); });
  srv_.Get("/api/workspaces", [this](const auto& r, auto& s) { handleWorkspaces(r, s); });
  srv_.Post("/api/workspaces/open", [this](const auto& r, auto& s) { handleWorkspaceOpen(r, s); });
  srv_.Post("/api/workspaces/use", [this](const auto& r, auto& s) { handleWorkspaceUse(r, s); });
  srv_.Post("/api/workspaces/pick", [this](const auto& r, auto& s) { handleWorkspacePick(r, s); });
  srv_.Post("/api/workspaces/create", [this](const auto& r, auto& s) { handleWorkspaceCreate(r, s); });
  srv_.Post("/api/workspaces/save", [this](const auto& r, auto& s) { handleWorkspaceSave(r, s); });
  srv_.Post("/api/workspaces/remove", [this](const auto& r, auto& s) { handleWorkspaceRemove(r, s); });
  srv_.Get("/api/tree", [this](const auto& r, auto& s) { handleTree(r, s); });
  srv_.Get("/api/git", [this](const auto& r, auto& s) { handleGit(r, s); });
  srv_.Get("/api/git/diff", [this](const auto& r, auto& s) { handleGitDiff(r, s); });
  srv_.Post("/api/git/action", [this](const auto& r, auto& s) { handleGitAction(r, s); });
  srv_.Get("/api/browser/state", [this](const auto& r, auto& s) { handleBrowserState(r, s); });
  srv_.Post("/api/browser/navigate", [this](const auto& r, auto& s) { handleBrowserNavigate(r, s); });
  srv_.Post("/api/browser/eval", [this](const auto& r, auto& s) { handleBrowserEval(r, s); });
  srv_.Get("/api/browser/shot", [this](const auto& r, auto& s) { handleBrowserShot(r, s); });
  srv_.Post("/api/browser/import", [this](const auto& r, auto& s) { handleBrowserImport(r, s); });
  srv_.Post("/api/projects/rename", [this](const auto& r, auto& s) { handleProjectRename(r, s); });
  srv_.Post("/api/projects/apply", [this](const auto& r, auto& s) { handleProjectApply(r, s); });
  srv_.Post("/api/projects/ai-organize", [this](const auto& r, auto& s) { handleAiOrganize(r, s); });
  srv_.Get(R"(/api/images/([A-Za-z0-9_.\-]+))",
           [this](const auto& r, auto& s) { handleImage(r, s); });
  srv_.Get("/api/file", [this](const auto& r, auto& s) { handleFile(r, s); });
  srv_.Get("/api/iui", [this](const auto& r, auto& s) { handleIuiGet(r, s); });
  srv_.Post("/api/iui", [this](const auto& r, auto& s) { handleIuiSet(r, s); });
  srv_.Get(R"(/.*)", [this](const auto& r, auto& s) { handleStatic(r, s); });
}

}  // namespace wbl
