#include "acp_client.h"

#include <algorithm>

namespace wbl {
namespace {

std::string ssePayload(const std::string& frame) {
  std::string out;
  size_t pos = 0;
  while (pos <= frame.size()) {
    size_t nl = frame.find('\n', pos);
    if (nl == std::string::npos) nl = frame.size();
    std::string line = frame.substr(pos, nl - pos);
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.rfind("data:", 0) == 0) {
      std::string v = line.substr(5);
      if (!v.empty() && v[0] == ' ') v.erase(0, 1);
      out += v;
    }
    if (nl == frame.size()) break;
    pos = nl + 1;
  }
  return out;
}

}  // namespace

httplib::Headers AcpClient::buildHeaders() const {
  httplib::Headers h = {
      {"X-CodeBuddy-Request", "1"},
      {"Accept", "application/json, text/event-stream"},
  };
  if (!connectionId_.empty()) h.emplace("acp-connection-id", connectionId_);
  if (!sessionToken_.empty()) h.emplace("Authorization", "Bearer " + sessionToken_);
  return h;
}

void AcpClient::open(const std::string& baseUrl) {
  baseUrl_ = baseUrl;
  closed_ = false;

  httplib::Client cli(baseUrl_);
  cli.set_connection_timeout(5, 0);
  cli.set_read_timeout(30, 0);
  auto res = cli.Post("/api/v1/acp/connect", {{"X-CodeBuddy-Request", "1"}}, "{}", "application/json");
  if (!res || res->status != 200) {
    throw std::runtime_error("ACP connect 失败: " + (res ? std::to_string(res->status) : "无响应"));
  }
  json body = json::parse(res->body, nullptr, false);
  if (body.is_discarded() || !body.contains("connectionId")) {
    throw std::runtime_error("ACP connect 返回异常: " + res->body.substr(0, 200));
  }
  connectionId_ = body["connectionId"].get<std::string>();
  sessionToken_ = body.value("sessionToken", "");
  logf("acp connected " + connectionId_);

  subThread_ = std::thread([this] { subscribeLoop(); });

  // 显式构造成员，避免嵌套初始化列表把字段拍平到顶层
  json fsCaps = {{"readTextFile", false}, {"writeTextFile", false}};
  json caps = {{"fs", fsCaps}, {"terminal", false}};
  json initParams = {{"protocolVersion", 1}, {"clientCapabilities", caps}};
  json init = request("initialize", initParams, 30);
  logf("acp initialized");
  (void)init;
}

void AcpClient::subscribeLoop() {
  httplib::Client cli(baseUrl_);
  cli.set_read_timeout(86400, 0);
  cli.set_connection_timeout(10, 0);
  subClientKey_ = "sub";
  logf("acp subscribe start");
  cli.Get("/api/v1/acp", buildHeaders(),
          [this](const char* data, size_t len) {
            sseBuf_.append(data, len);
            size_t idx;
            while ((idx = sseBuf_.find("\n\n")) != std::string::npos) {
              std::string frame = sseBuf_.substr(0, idx);
              sseBuf_.erase(0, idx + 2);
              std::string payload = ssePayload(frame);
              if (!payload.empty()) dispatchFrame(payload);
            }
            return !closed_.load();
          });
  logf("acp subscribe ended");
}

void AcpClient::dispatchFrame(const std::string& data) {
  json msg = json::parse(data, nullptr, false);
  if (msg.is_discarded() || !msg.is_object()) return;
  handleMessage(msg);
}

void AcpClient::handleMessage(const json& msg) {
  // 1) agent 发起的反向请求（带 id + method），例如 session/request_permission
  if (msg.contains("method") && msg.contains("id") && !msg["id"].is_null()) {
    if (onAgentRequest_) {
      int64_t id = msg["id"].get<int64_t>();
      std::string method = msg["method"].get<std::string>();
      json params = msg.value("params", json::object());
      // 不能阻塞 SSE 读线程
      std::thread([this, id, method, params] {
        if (onAgentRequest_) onAgentRequest_(id, method, params);
      }).detach();
    }
    return;
  }
  // 2) 通知（只有 method）
  if (msg.contains("method")) {
    std::string method = msg["method"].get<std::string>();
    if (method == "session/update") {
      const json& params = msg["params"];
      std::string sid = params.value("sessionId", "");
      if (onUpdate_) onUpdate_(params.value("update", json::object()), sid);
    }
    return;
  }
  // 3) 我们的请求的响应
  if (msg.contains("id") && !msg["id"].is_null()) {
    int64_t id = msg["id"].get<int64_t>();
    std::shared_ptr<Pending> p;
    {
      std::lock_guard<std::mutex> lk(pendingMu_);
      auto it = pending_.find(id);
      if (it != pending_.end()) p = it->second;
    }
    if (p) {
      std::lock_guard<std::mutex> lk(p->mu);
      p->response = msg;
      p->done = true;
      p->cv.notify_all();
    }
  }
}

json AcpClient::request(const std::string& method, const json& params, int timeoutSec) {
  int64_t id = nextId_++;
  auto p = std::make_shared<Pending>();
  {
    std::lock_guard<std::mutex> lk(pendingMu_);
    pending_[id] = p;
  }

  json body = {{"jsonrpc", "2.0"}, {"id", id}, {"method", method}, {"params", params}};
  std::string payload = body.dump();

  // POST 自身会返回一段 SSE，就地解析；响应也可能从订阅流回来，两边都进 dispatchFrame。
  std::thread([this, payload, timeoutSec] {
    httplib::Client cli(baseUrl_);
    cli.set_connection_timeout(10, 0);
    cli.set_read_timeout(timeoutSec > 0 ? timeoutSec : 86400, 0);
    std::string buf;
    cli.Post("/api/v1/acp", buildHeaders(), payload, "application/json",
             [this, &buf](const char* data, size_t len) {
               buf.append(data, len);
               size_t idx;
               while ((idx = buf.find("\n\n")) != std::string::npos) {
                 std::string frame = buf.substr(0, idx);
                 buf.erase(0, idx + 2);
                 std::string p2 = ssePayload(frame);
                 if (!p2.empty()) dispatchFrame(p2);
               }
               return true;
             });
  }).detach();

  {
    std::unique_lock<std::mutex> lk(p->mu);
    bool ok = p->cv.wait_for(lk, std::chrono::seconds(timeoutSec > 0 ? timeoutSec : 86400),
                             [&] { return p->done; });
    if (!ok) {
      std::lock_guard<std::mutex> lk2(pendingMu_);
      pending_.erase(id);
      throw std::runtime_error(method + " 超时");
    }
  }
  {
    std::lock_guard<std::mutex> lk(pendingMu_);
    pending_.erase(id);
  }

  if (p->response.contains("error") && !p->response["error"].is_null()) {
    const json& e = p->response["error"];
    std::string msg = e.is_object() ? e.value("message", e.dump()) : e.dump();
    logf("rpc " + method + " 失败: " + msg + " payload=" + payload.substr(0, 600));
    throw std::runtime_error(method + " 失败: " + msg);
  }
  return p->response.value("result", json::object());
}

void AcpClient::reply(int64_t id, const json& result) {
  json body = {{"jsonrpc", "2.0"}, {"id", id}, {"result", result}};
  httplib::Client cli(baseUrl_);
  cli.set_connection_timeout(5, 0);
  cli.set_read_timeout(15, 0);
  cli.Post("/api/v1/acp", buildHeaders(), body.dump(), "application/json");
}

void AcpClient::notify(const std::string& method, const json& params) {
  json body = {{"jsonrpc", "2.0"}, {"method", method}, {"params", params}};
  httplib::Client cli(baseUrl_);
  cli.set_connection_timeout(5, 0);
  cli.set_read_timeout(15, 0);
  cli.Post("/api/v1/acp", buildHeaders(), body.dump(), "application/json");
}

json AcpClient::newSessionInfo(const std::string& cwd) {
  return request("session/new", {{"cwd", cwd}, {"mcpServers", json::array()}}, 180);
}

std::string AcpClient::newSession(const std::string& cwd) {
  return jstr(newSessionInfo(cwd), "sessionId");
}

std::string AcpClient::loadSession(const std::string& sessionId, const std::string& cwd) {
  request("session/load",
          {{"sessionId", sessionId}, {"cwd", cwd}, {"mcpServers", json::array()}}, 180);
  return sessionId;
}

json AcpClient::setConfigOption(const std::string& sessionId, const std::string& configId,
                                const std::string& value) {
  return request(
      "session/set_config_option",
      {{"sessionId", sessionId}, {"configId", configId}, {"value", value}}, 60);
}

json AcpClient::prompt(const std::string& sessionId, const std::string& text, const json& images,
                        int timeoutSec) {
  json promptArr = json::array();
  // 图片块按 ACP 约定是 {type:image, mimeType, data(base64)}；文字放最后，模型先看图再读要求
  if (images.is_array()) {
    for (const auto& img : images) {
      std::string mime = jstr(img, "mime", "image/png");
      std::string data = jstr(img, "data");
      if (data.empty()) continue;
      promptArr.push_back({{"type", "image"}, {"mimeType", mime}, {"data", data}});
    }
  }
  if (!text.empty() || promptArr.empty()) {
    promptArr.push_back({{"type", "text"}, {"text", text}});
  }
  return request("session/prompt", {{"sessionId", sessionId}, {"prompt", promptArr}}, timeoutSec);
}

void AcpClient::cancel(const std::string& sessionId) {
  notify("session/cancel", {{"sessionId", sessionId}});
}

void AcpClient::close() {
  if (closed_.exchange(true)) return;
  try {
    httplib::Client cli(baseUrl_);
    cli.set_connection_timeout(2, 0);
    cli.set_read_timeout(3, 0);
    cli.Delete("/api/v1/acp", buildHeaders());
  } catch (...) {
  }
  if (subThread_.joinable()) {
    // 订阅线程可能阻塞在 read 上，进程退出时交给系统回收
    subThread_.detach();
  }
  std::lock_guard<std::mutex> lk(pendingMu_);
  for (auto& [id, p] : pending_) {
    std::lock_guard<std::mutex> lk2(p->mu);
    p->done = true;
    p->cv.notify_all();
  }
  pending_.clear();
}

}  // namespace wbl
