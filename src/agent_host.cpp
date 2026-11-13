#include "agent_host.h"

#include <winsock2.h>
#include <ws2tcpip.h>

#include <cstring>

#include "httplib.h"

#pragma comment(lib, "ws2_32.lib")

namespace wbl {
namespace {

void ensureWinsock() {
  static bool inited = false;
  if (!inited) {
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
    inited = true;
  }
}

// 把 "KEY=1" 形式追加/覆盖到环境块
std::wstring mergeEnv(const std::wstring& block, const std::vector<std::pair<std::string, std::string>>& kv) {
  std::vector<std::wstring> entries;
  const wchar_t* p = block.c_str();
  while (*p) {
    std::wstring e(p);
    p += e.size() + 1;
    if (e.empty()) break;
    bool overridden = false;
    for (const auto& [k, v] : kv) {
      std::wstring wk = utf8ToWide(k) + L"=";
      if (e.rfind(wk, 0) == 0) {
        overridden = true;
        break;
      }
    }
    if (!overridden) entries.push_back(e);
  }
  for (const auto& [k, v] : kv) entries.push_back(utf8ToWide(k) + L"=" + utf8ToWide(v));

  std::wstring out;
  for (const auto& e : entries) {
    out += e;
    out.push_back(L'\0');
  }
  out.push_back(L'\0');
  return out;
}

}  // namespace

int AgentHost::findFreePort(int startPort) {
  ensureWinsock();
  for (int port = startPort; port < startPort + 200; ++port) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) continue;
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons((u_short)port);
    inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
    int ok = bind(s, (sockaddr*)&addr, sizeof(addr));
    closesocket(s);
    if (ok == 0) return port;
  }
  return 0;
}

std::wstring AgentHost::buildEnvBlock() {
  LPWCH cur = GetEnvironmentStringsW();
  std::wstring block;
  if (cur) {
    const wchar_t* p = cur;
    while (*p) {
      std::wstring e(p);
      p += e.size() + 1;
      block += e;
      block.push_back(L'\0');
    }
    block.push_back(L'\0');
    FreeEnvironmentStringsW(cur);
  }
  return mergeEnv(block,
                  {
                      // 只监听回环，关掉网关口令与自定义头校验，让本地 UI 直连
                      {"CODEBUDDY_GATEWAY_AUTH", "none"},
                      {"CODEBUDDY_DISABLE_REQUEST_VALIDATION", "1"},
                      {"CODEBUDDY_DISABLE_AUTOUPDATE", "1"},
                      {"CODEBUDDY_DISABLE_BROWSER_MCP", "1"},
                      {"CODEBUDDY_DISABLE_IDE", "1"},
                      {"FORCE_COLOR", "0"},
                  });
}

void AgentHost::pumpPipe() {
  char buf[4096];
  DWORD read = 0;
  while (ReadFile(pipeRead_, buf, sizeof(buf) - 1, &read, nullptr) && read > 0) {
    buf[read] = '\0';
    std::string s(buf, read);
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) s.pop_back();
    if (!s.empty()) logf("[agent] " + s.substr(0, 600));
  }
}

void AgentHost::start(int timeoutMs, const std::string& cli) {
  if (ready_) return;
  port_ = findFreePort(8390);
  if (port_ == 0) throw std::runtime_error("找不到可用端口");
  baseUrl_ = "http://127.0.0.1:" + std::to_string(port_);

  SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
  HANDLE pipeWrite = nullptr;
  if (!CreatePipe(&pipeRead_, &pipeWrite, &sa, 0)) throw std::runtime_error("CreatePipe 失败");
  SetHandleInformation(pipeRead_, HANDLE_FLAG_INHERIT, 0);

  std::wstring cmd = L"cmd.exe /c " + utf8ToWide(cli) + L" --serve --port " + std::to_wstring(port_) +
                     L" --host 127.0.0.1";
  std::wstring env = buildEnvBlock();

  STARTUPINFOW si{};
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
  si.wShowWindow = SW_HIDE;
  si.hStdOutput = pipeWrite;
  si.hStdError = pipeWrite;
  // STARTF_USESTDHANDLES 要求三个句柄都有效，stdin 给 NUL
  HANDLE nulIn = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING,
                             0, nullptr);
  si.hStdInput = (nulIn == INVALID_HANDLE_VALUE) ? nullptr : nulIn;

  std::vector<wchar_t> cmdbuf(cmd.begin(), cmd.end());
  cmdbuf.push_back(L'\0');

  logf("spawn: " + wideToUtf8(cmd));
  BOOL ok = CreateProcessW(nullptr, cmdbuf.data(), nullptr, nullptr, TRUE,
                           CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, env.data(), nullptr, &si, &pi_);
  CloseHandle(pipeWrite);
  if (nulIn != INVALID_HANDLE_VALUE && nulIn) CloseHandle(nulIn);
  if (!ok) {
    CloseHandle(pipeRead_);
    pipeRead_ = nullptr;
    throw std::runtime_error("启动 codebuddy 失败，错误码 " + std::to_string(GetLastError()));
  }
  pump_ = std::thread([this] { pumpPipe(); });

  // 轮询健康检查
  int waited = 0;
  while (waited < timeoutMs) {
    DWORD code = 0;
    if (WaitForSingleObject(pi_.hProcess, 0) == WAIT_OBJECT_0) {
      GetExitCodeProcess(pi_.hProcess, &code);
      lastError_ = "codebuddy --serve 提前退出，code=" + std::to_string(code);
      throw std::runtime_error(lastError_);
    }
    {
      httplib::Client cli2(baseUrl_);
      cli2.set_connection_timeout(2, 0);
      cli2.set_read_timeout(3, 0);
      auto res = cli2.Get("/api/v1/health", httplib::Headers{{"X-CodeBuddy-Request", "1"}});
      if (res && res->status == 200) {
        ready_ = true;
        logf("agent ready at " + baseUrl_);
        return;
      }
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    waited += 500;
  }
  lastError_ = "等待 codebuddy --serve 启动超时";
  throw std::runtime_error(lastError_);
}

void AgentHost::stop() {
  stopping_ = true;
  ready_ = false;
  if (pi_.hProcess) {
    // codebuddy 是 cmd.exe 的子进程，必须整棵树杀
    std::wstring cmd = L"cmd.exe /c taskkill /F /T /PID " + std::to_wstring(pi_.dwProcessId) + L" > NUL 2>&1";
    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION killPi{};
    std::vector<wchar_t> buf(cmd.begin(), cmd.end());
    buf.push_back(L'\0');
    if (CreateProcessW(nullptr, buf.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si,
                       &killPi)) {
      WaitForSingleObject(killPi.hProcess, 5000);
      CloseHandle(killPi.hProcess);
      CloseHandle(killPi.hThread);
    }
    CloseHandle(pi_.hProcess);
    CloseHandle(pi_.hThread);
    pi_ = {};
  }
  if (pipeRead_) {
    CloseHandle(pipeRead_);
    pipeRead_ = nullptr;
  }
  if (pump_.joinable()) pump_.join();
}

}  // namespace wbl
