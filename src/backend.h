// 本地后端：对内起 HTTP 服务（静态页面 + 事件流），对外驱动 codebuddy ACP。
#pragma once

#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>

#include "acp_client.h"
#include "agent_host.h"
#include "common.h"
#include "httplib.h"

namespace wbl {

class Backend {
 public:
  Backend(bool demo, std::string cwd, std::string webRoot, bool fresh = false);
  ~Backend();

  bool start();  // 绑定端口并在后台线程 listen
  void stop();
  int port() const { return port_; }
  std::string url() const { return "http://127.0.0.1:" + std::to_string(port_) + "/"; }
  std::string statusText() const;
  std::string currentWorkspace() const { return currentCwd(); }

 private:
  void setupRoutes();
  void initStore();
  void saveStore();
  std::string currentCwd() const;

  // 会话
  json* findSession(const std::string& uiId);
  json createSession(const std::string& cwd, const std::string& title);
  void appendEvent(const std::string& uiId, const std::string& type, json data);
  void emit(const std::string& uiId, const std::string& type, json data);

  // Agent 生命周期
  bool ensureAgent(std::string& err);
  void wireAgentCallbacks();
  void runPrompt(const std::string& uiId, const std::string& text, const std::string& mode,
                 const json& images, const std::string& model);
  void runDemo(const std::string& uiId, const std::string& text);
  std::string acpSessionFor(const std::string& uiId, std::string& err);

  // 模型目录：session/new 回来的 models/configOptions 是唯一权威来源
  void setModelCatalog(const json& availableModels, const std::string& currentId);
  void absorbSessionInfo(const json& info, const std::string& uiId);
  json takeSpareSession(const std::string& cwd);
  bool ensureModelCatalog(std::string& err);
  std::string selectedModel() const;

  // 积分：按 requestId 去重，credit 是实扣、original_credit 是原价
  void mergeUsage(json& session, const json& data);
  json latestQuota();
  json usageSummary();

  // 工作空间
  json workspaceList();
  json scannedWorkspaces();
  std::string runOrganizerPrompt(const std::string& prompt, std::string& err);
  bool spawnWindow(const std::string& path);
  std::string pickFolder();
  json agentGet(const std::string& path);

  // 图片落盘：事件里只存 URL，避免 base64 把 sessions.json 撑爆
  json saveImages(const json& incoming);

  // 路由处理器
  void handleBootstrap(const httplib::Request&, httplib::Response&);
  void handleSessions(const httplib::Request&, httplib::Response&);
  void handleSessionDetail(const httplib::Request&, httplib::Response&);
  void handleChat(const httplib::Request&, httplib::Response&);
  void handlePermission(const httplib::Request&, httplib::Response&);
  void handleCancel(const httplib::Request&, httplib::Response&);
  void handleStream(const httplib::Request&, httplib::Response&);
  void handleDeleteSession(const httplib::Request&, httplib::Response&);
  void handleRename(const httplib::Request&, httplib::Response&);
  void handleCatalog(const httplib::Request&, httplib::Response&);
  void handleImage(const httplib::Request&, httplib::Response&);
  void handleFile(const httplib::Request&, httplib::Response&);
  void handleIuiGet(const httplib::Request&, httplib::Response&);
  void handleIuiSet(const httplib::Request&, httplib::Response&);
  void handleModels(const httplib::Request&, httplib::Response&);
  void handleSetModel(const httplib::Request&, httplib::Response&);
  void handleUsage(const httplib::Request&, httplib::Response&);
  void handleWorkspaces(const httplib::Request&, httplib::Response&);
  void handleWorkspaceOpen(const httplib::Request&, httplib::Response&);
  void handleWorkspaceUse(const httplib::Request&, httplib::Response&);
  void handleWorkspacePick(const httplib::Request&, httplib::Response&);
  void handleWorkspaceCreate(const httplib::Request&, httplib::Response&);
  void handleProjectRename(const httplib::Request&, httplib::Response&);
  void handleProjectApply(const httplib::Request&, httplib::Response&);
  void handleAiOrganize(const httplib::Request&, httplib::Response&);
  void handleStatic(const httplib::Request&, httplib::Response&);

  bool demo_ = false;
  bool fresh_ = false;
  std::string cwd_;
  mutable std::mutex cwdMu_;
  std::string webRoot_;
  std::string exePath_;
  int port_ = 0;

  httplib::Server srv_;
  std::thread listenThread_;
  std::atomic<bool> stopped_{false};

  EventBus bus_;

  std::unique_ptr<AgentHost> host_;
  std::unique_ptr<AcpClient> client_;
  std::mutex agentMu_;
  std::atomic<bool> agentReady_{false};
  std::string agentError_;

  std::mutex storeMu_;
  json store_ = json::object();
  std::set<std::string> deletedIds_;

  std::mutex mapMu_;
  std::map<std::string, std::string> acpToUi_;   // acpSessionId -> uiId
  std::map<std::string, std::string> uiToAcp_;   // uiId -> acpSessionId
  std::map<std::string, std::pair<int64_t, std::string>> pendingPerm_;  // requestId -> (rpcId, uiId)
  std::map<std::string, std::string> permResults_;   // 演示模式下前端的选择结果
  std::set<std::string> running_;                // 正在跑的 uiId

  // 模型目录 + 预热会话（第一次点模型菜单时创建，随后被首个会话复用）
  mutable   std::mutex modelMu_;
  json modelCatalog_ = json{{"models", json::array()}, {"currentId", ""}};
  std::string selectedModel_;
  json spareAcp_ = json::object();

  // CodeBuddy / WorkBuddy 历史项目扫描缓存（workspace 对话框偶尔才打开）
  std::mutex aiRunMu_;
  std::mutex aiTextMu_;
  std::map<std::string, std::string> aiText_;

  mutable std::mutex wsCacheMu_;
  json wsCache_ = json::array();
  int64_t wsCacheAt_ = 0;
};

}  // namespace wbl
