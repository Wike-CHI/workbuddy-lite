// 拉起并守护 `codebuddy --serve`，把它当成 Agent 运行时。
#pragma once

#include <string>

#include "common.h"

namespace wbl {

class AgentHost {
 public:
  AgentHost() = default;
  ~AgentHost() { stop(); }

  // 启动子进程并等待 /api/v1/health 可用。失败抛异常。
  void start(int timeoutMs = 90000, const std::string& cli = "codebuddy");
  void stop();

  bool ready() const { return ready_; }
  std::string baseUrl() const { return baseUrl_; }
  const std::string& lastError() const { return lastError_; }

 private:
  static int findFreePort(int startPort);
  static std::wstring buildEnvBlock();
  void pumpPipe();

  PROCESS_INFORMATION pi_{};
  HANDLE pipeRead_ = nullptr;
  std::thread pump_;
  std::atomic<bool> ready_{false};
  std::atomic<bool> stopping_{false};
  int port_ = 0;
  std::string baseUrl_;
  std::string lastError_;
};

}  // namespace wbl
