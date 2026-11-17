// 独立更新器：等旧进程退出后换掉 exe，再带原参数启动新进程。
// 只做「替换 + 重启」，不是安装器。构建产物：bin/workbuddy-updater.exe。
#include <windows.h>
#include <shellapi.h>

#include <cstdio>
#include <ctime>
#include <fstream>
#include <string>
#include <vector>

namespace {

std::wstring g_logPath;
std::wstring g_targetName;

std::string narrow(const std::wstring& s) {
  if (s.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0, nullptr, nullptr);
  std::string out(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), n, nullptr, nullptr);
  return out;
}

void logLine(const std::wstring& text) {
  if (g_logPath.empty()) return;
  std::ofstream out(g_logPath.c_str(), std::ios::binary | std::ios::app);
  if (!out) return;
  std::time_t now = std::time(nullptr);
  char stamp[32] = {0};
  std::tm local{};
  localtime_s(&local, &now);
  std::strftime(stamp, sizeof(stamp), "%Y-%m-%d %H:%M:%S", &local);
  out << stamp << " [updater] " << narrow(text) << "\r\n";
}

std::wstring dirOf(const std::wstring& path) {
  size_t pos = path.find_last_of(L"\\/");
  return pos == std::wstring::npos ? L"." : path.substr(0, pos);
}

std::wstring nameOf(const std::wstring& path) {
  size_t pos = path.find_last_of(L"\\/");
  return pos == std::wstring::npos ? path : path.substr(pos + 1);
}

std::wstring quoteArg(const std::wstring& arg) {
  if (arg.empty()) return L"\"\"";
  if (arg.find_first_of(L" \t\n\v\"") == std::wstring::npos) return arg;
  std::wstring out = L"\"";
  int backslashes = 0;
  for (wchar_t c : arg) {
    if (c == L'\\') {
      ++backslashes;
      continue;
    }
    if (c == L'"') {
      out.append(static_cast<size_t>(backslashes * 2 + 1), L'\\');
      out.push_back(L'"');
    } else {
      out.append(static_cast<size_t>(backslashes), L'\\');
      out.push_back(c);
    }
    backslashes = 0;
  }
  out.append(static_cast<size_t>(backslashes * 2), L'\\');
  out.push_back(L'"');
  return out;
}

bool fileExists(const std::wstring& path) {
  DWORD attr = GetFileAttributesW(path.c_str());
  return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY);
}

bool waitForExit(DWORD pid, int timeoutSec) {
  HANDLE h = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) {
    // 进程已经不在了（或没权限也是同一个结论：没东西可等）
    logLine(L"目标进程已退出 pid=" + std::to_wstring(pid));
    return true;
  }
  DWORD wait = WaitForSingleObject(h, static_cast<DWORD>(timeoutSec) * 1000);
  CloseHandle(h);
  if (wait == WAIT_TIMEOUT) {
    logLine(L"等待 pid=" + std::to_wstring(pid) + L" 超时（" + std::to_wstring(timeoutSec) + L"s），放弃替换");
    return false;
  }
  logLine(L"目标进程已退出 pid=" + std::to_wstring(pid));
  return true;
}

bool moveWithRetry(const std::wstring& from, const std::wstring& to, int tries) {
  for (int i = 0; i < tries; ++i) {
    if (MoveFileExW(from.c_str(), to.c_str(), MOVEFILE_REPLACE_EXISTING)) return true;
    DWORD err = GetLastError();
    if (i == 0) logLine(L"移动失败 " + from + L" -> " + to + L"，错误码 " + std::to_wstring(err) + L"，重试中");
    Sleep(250);
  }
  return false;
}

// 上次没删掉的 .old.* 在这里顺手清一遍
void cleanupStale(const std::wstring& targetDir) {
  if (g_targetName.empty()) return;
  WIN32_FIND_DATAW data{};
  std::wstring pattern = targetDir + L"\\" + g_targetName + L".old.*";
  HANDLE find = FindFirstFileW(pattern.c_str(), &data);
  if (find == INVALID_HANDLE_VALUE) return;
  do {
    if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
    std::wstring path = targetDir + L"\\" + data.cFileName;
    if (DeleteFileW(path.c_str())) logLine(L"清理旧文件 " + path);
  } while (FindNextFileW(find, &data));
  FindClose(find);
}

struct Options {
  DWORD pid = 0;
  std::wstring next;
  std::wstring target;
  int timeoutSec = 30;
  std::vector<std::wstring> appArgs;
};

bool parseArgs(int argc, wchar_t** argv, Options& opt) {
  for (int i = 1; i < argc; ++i) {
    std::wstring arg = argv[i];
    if (arg == L"--") {
      for (int j = i + 1; j < argc; ++j) opt.appArgs.push_back(argv[j]);
      return true;
    }
    auto value = [&](std::wstring& out) {
      if (i + 1 >= argc) return false;
      out = argv[++i];
      return true;
    };
    if (arg == L"--pid") {
      std::wstring v;
      if (!value(v)) return false;
      opt.pid = static_cast<DWORD>(_wtoi(v.c_str()));
    } else if (arg == L"--next") {
      if (!value(opt.next)) return false;
    } else if (arg == L"--target") {
      if (!value(opt.target)) return false;
    } else if (arg == L"--timeout") {
      std::wstring v;
      if (!value(v)) return false;
      opt.timeoutSec = _wtoi(v.c_str());
    } else {
      logLine(L"忽略未知参数 " + arg);
    }
  }
  return true;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  Options opt;
  if (!parseArgs(argc, argv, opt) || opt.pid == 0 || opt.next.empty() || opt.target.empty()) {
    return 64;
  }
  if (opt.timeoutSec <= 0) opt.timeoutSec = 30;

  const std::wstring targetDir = dirOf(opt.target);
  g_targetName = nameOf(opt.target);
  g_logPath = targetDir + L"\\updater.log";

  logLine(L"启动 pid=" + std::to_wstring(opt.pid) + L" next=" + opt.next + L" target=" + opt.target +
          L" timeout=" + std::to_wstring(opt.timeoutSec) + L"s args=" + std::to_wstring(opt.appArgs.size()));

  cleanupStale(targetDir);

  if (!waitForExit(opt.pid, opt.timeoutSec)) return 2;

  if (!fileExists(opt.next)) {
    logLine(L"next 不存在，放弃替换: " + opt.next);
    return 3;
  }

  const std::wstring stamp = std::to_wstring(static_cast<long long>(std::time(nullptr)));
  const std::wstring oldPath = opt.target + L".old." + stamp;

  bool renamed = false;
  if (fileExists(opt.target)) {
    if (!moveWithRetry(opt.target, oldPath, 20)) {
      logLine(L"重命名 target 失败，放弃替换（target 保持原样）");
      return 4;
    }
    renamed = true;
    logLine(L"target -> " + oldPath);
  }

  if (!moveWithRetry(opt.next, opt.target, 30)) {
    logLine(L"next -> target 失败，回滚");
    if (renamed) {
      if (MoveFileExW(oldPath.c_str(), opt.target.c_str(), MOVEFILE_REPLACE_EXISTING)) {
        logLine(L"已回滚旧版本 " + opt.target);
      } else {
        logLine(L"回滚失败，旧版本保留在 " + oldPath);
      }
    }
    return 5;
  }
  logLine(L"next -> target 完成");

  std::wstring cmd = quoteArg(opt.target);
  for (const auto& arg : opt.appArgs) cmd += L" " + quoteArg(arg);

  wchar_t cwd[MAX_PATH] = {0};
  GetCurrentDirectoryW(MAX_PATH, cwd);

  STARTUPINFOW si{};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi{};
  std::vector<wchar_t> buf(cmd.begin(), cmd.end());
  buf.push_back(L'\0');
  BOOL ok = CreateProcessW(opt.target.c_str(), buf.data(), nullptr, nullptr, FALSE, CREATE_UNICODE_ENVIRONMENT,
                           nullptr, cwd, &si, &pi);
  if (!ok) {
    DWORD err = GetLastError();
    logLine(L"启动新进程失败，错误码 " + std::to_wstring(err) + L"，可手动运行 " + opt.target);
    if (renamed) logLine(L"旧版本保留在 " + oldPath);
    return 6;
  }
  logLine(L"新进程已启动 pid=" + std::to_wstring(pi.dwProcessId));
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);

  if (renamed && !DeleteFileW(oldPath.c_str())) {
    logLine(L"旧版本暂时删不掉，留给下次启动清理: " + oldPath);
  }
  logLine(L"完成");
  return 0;
}
