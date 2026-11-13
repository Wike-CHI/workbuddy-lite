// ACP（Agent Client Protocol）客户端：把 codebuddy --serve 的 /api/v1/acp
// 封装成 request / 通知 / 反向请求三类回调。
#pragma once

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>

#include "common.h"
#include "httplib.h"

namespace wbl {

class AcpClient {
 public:
  using UpdateFn = std::function<void(const json& update, const std::string& sessionId)>;
  using AgentRequestFn = std::function<void(int64_t id, const std::string& method, const json& params)>;

  AcpClient() = default;
  ~AcpClient() { close(); }

  void open(const std::string& baseUrl);
  void close();

  bool isOpen() const { return !connectionId_.empty(); }

  json request(const std::string& method, const json& params, int timeoutSec = 180);
  void reply(int64_t id, const json& result);
  void notify(const std::string& method, const json& params);

  std::string newSession(const std::string& cwd);
  // session/new 的完整结果里有 models/configOptions，模型目录从这里取
  json newSessionInfo(const std::string& cwd);
  std::string loadSession(const std::string& sessionId, const std::string& cwd);
  json setConfigOption(const std::string& sessionId, const std::string& configId, const std::string& value);
  json prompt(const std::string& sessionId, const std::string& text,
              const json& images = json::array(), int timeoutSec = 0);
  void cancel(const std::string& sessionId);

  void onUpdate(UpdateFn fn) { onUpdate_ = std::move(fn); }
  void onAgentRequest(AgentRequestFn fn) { onAgentRequest_ = std::move(fn); }

 private:
  struct Pending {
    std::mutex mu;
    std::condition_variable cv;
    bool done = false;
    json response;
  };

  void subscribeLoop();
  void dispatchFrame(const std::string& data);
  void handleMessage(const json& msg);
  httplib::Headers buildHeaders() const;

  std::string baseUrl_;
  std::string connectionId_;
  std::string sessionToken_;
  std::string sseBuf_;
  std::atomic<int64_t> nextId_{1};

  std::mutex pendingMu_;
  std::map<int64_t, std::shared_ptr<Pending>> pending_;

  std::thread subThread_;
  std::atomic<bool> closed_{false};
  std::string subClientKey_;

  UpdateFn onUpdate_;
  AgentRequestFn onAgentRequest_;

  std::mutex sendMu_;
};

}  // namespace wbl
