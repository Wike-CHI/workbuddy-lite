// 本地后端：对内起 HTTP 服务（静态页面 + 事件流），对外驱动 codebuddy ACP。
#pragma once

#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

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
  std::string workspaceName() const;
  // 浏览器由 main.cpp 注入（WebView2 只能在 UI 线程调用）
  void setBrowserHooks(std::function<std::string(const std::string&)> eval,
                       std::function<void(const std::string&)> navigate,
                       std::function<std::string()> state,
                       std::function<std::string(const std::string&)> shot,
                       std::function<std::string()> importCookies);
  // 自更新时由 main.cpp 注入「关窗口退出」，让 HTTP 线程能触发正常退出路径
  void setExitHook(std::function<void()> hook);

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
  // 与 agentGet 同源同 header，但不解包 data：返回 {status, doc, error?}，由上层裁剪。
  // method 只支持 GET/POST/PATCH；timeoutSec 是读超时（写操作 15s，避免落消息后长时间挂住）。
  json agentSend(const std::string& method, const std::string& path, const json& body,
                 int timeoutSec = 10);
  // agent 的 stats / recents 很慢（0.5–1.2s），缓存 + 后台刷新，别卡住 HTTP 线程
  json cliStats();
  json agentRecents();

  // 插件市场：真实状态在 CLI 的 known_marketplaces/installed_plugins 里，这里只读不另建索引
  json marketOverview();
  void initDemoMarket();
  json demoParseMarket(const std::string& url, const std::string& name);
  json demoApplyInstalled(const std::string& key, bool installed, std::string& err);
  json marketDemoSnapshot();
  void startMarketJob(const std::string& action, const std::string& plugin,
                      const std::string& marketplace, const std::string& jobId);
  void startMarketParseJob(const std::string& url, const std::string& name, const std::string& jobId);
  json runMarketParse(const std::string& url, std::string name, int& status);
  json findMarketJob(const std::string& id);

  // 群聊（agent-home 频道）：只做 CLI 的第四个客户端，不另存消息库。
  // state/messages 都必须裁字段；events 只回增量消息，避免把 995KB/4s 的 SSE 快照转给 WebView。
  json trimTeamAgent(const json& agent);
  // 单 bot 详情：列表态刻意不带 description（可达 2000 字），只有点开详情才取
  json trimTeamAgentDetail(const json& agent);
  json trimTeamChannel(const json& channel);
  json trimTeamMessage(const json& message);
  json teamStateFromCli();
  json teamPageFromCli(const std::string& channelId, const std::string& before,
                       const std::string& after, json& page);
  void teamSeedCursor(const std::string& channelId, const std::string& after, bool reset);
  // 未读：CLI 只会「设置/清零」unreadByUser，不会自增；计数放在壳里，游标持久化到 ui-state.json
  int teamUnreadCount(const std::string& channelId, int cliUnread);
  void loadTeamReadCursors();
  void refreshTeamUnread();
  void teamMarkRead(const std::string& channelId);
  void initDemoTeam();
  json demoTeamState();
  json demoTeamMessages(const std::string& channelId);
  json demoTeamSend(const std::string& channelId, const std::string& text, const json& mentions,
                    const std::string& replyTo);
  json demoTeamCreateChannel(const std::string& name, const json& members, const std::string& leadId);
  json demoTeamUpdateMembers(const std::string& channelId, const json& members, std::string& error);
  json demoTeamUpdateLead(const std::string& channelId, const std::string& leadId, std::string& error);
  json demoTeamAgent(const std::string& id);
  json demoTeamCreateAgent(const std::string& name, const std::string& title,
                           const std::string& description, const std::string& model,
                           const std::string& homeCwd, std::string& error);
  json demoTeamUpdateAgent(const std::string& id, const json& patch, std::string& error);
  void demoTeamFlush();
  void handleTeamState(const httplib::Request&, httplib::Response&);
  void handleTeamUnread(const httplib::Request&, httplib::Response&);
  void handleTeamRead(const httplib::Request&, httplib::Response&);
  void handleTeamCreate(const httplib::Request&, httplib::Response&);
  void handleTeamMessages(const httplib::Request&, httplib::Response&);
  void handleTeamSend(const httplib::Request&, httplib::Response&);
  void handleTeamEvents(const httplib::Request&, httplib::Response&);
  void handleTeamMember(const httplib::Request&, httplib::Response&);
  void handleTeamRestart(const httplib::Request&, httplib::Response&);
  void handleTeamMembers(const httplib::Request&, httplib::Response&);
  void handleTeamLead(const httplib::Request&, httplib::Response&);
  void handleTeamAgentGet(const httplib::Request&, httplib::Response&);
  void handleTeamAgentCreate(const httplib::Request&, httplib::Response&);
  void handleTeamAgentUpdate(const httplib::Request&, httplib::Response&);

  // 多文件夹工作空间：一个名字 + 最多 5 个文件夹，cwd 取第一个
  json findWorkspace(const std::string& id);
  json workspaceByFolder(const std::string& path);
  void activateWorkspace(const json& ws, bool persist, const std::string& preferredCwd = "");
  void resolveInitialWorkspace();
  json activeWorkspaceInfo() const;
  json renameWorkspaceByFolder(const std::string& path, const std::string& name);

  // 右栏：文件树 / git / diff
  bool pathInWorkspace(const std::string& path) const;
  json workspaceTree(const std::string& path);
  json gitOverview();
  json gitDiff(const std::string& absPath, bool staged);
  json gitAction(const std::string& action, const std::string& folder,
                 const std::vector<std::string>& paths, const std::string& message);

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
  void handleMarketOverview(const httplib::Request&, httplib::Response&);
  void handleMarketParse(const httplib::Request&, httplib::Response&);
  void handleMarketInstall(const httplib::Request&, httplib::Response&);
  void handleMarketUninstall(const httplib::Request&, httplib::Response&);
  void handleMarketJob(const httplib::Request&, httplib::Response&);
  void handleImage(const httplib::Request&, httplib::Response&);
  void handleFile(const httplib::Request&, httplib::Response&);
  void handleIuiGet(const httplib::Request&, httplib::Response&);
  void handleIuiSet(const httplib::Request&, httplib::Response&);
  void handleModels(const httplib::Request&, httplib::Response&);
  void handleSetModel(const httplib::Request&, httplib::Response&);
  void handleConfig(const httplib::Request&, httplib::Response&);
  void handleUsage(const httplib::Request&, httplib::Response&);
  void handleWorkspaces(const httplib::Request&, httplib::Response&);
  void handleWorkspaceOpen(const httplib::Request&, httplib::Response&);
  void handleWorkspaceUse(const httplib::Request&, httplib::Response&);
  void handleWorkspacePick(const httplib::Request&, httplib::Response&);
  void handleWorkspaceCreate(const httplib::Request&, httplib::Response&);
  void handleWorkspaceSave(const httplib::Request&, httplib::Response&);
  void handleWorkspaceRemove(const httplib::Request&, httplib::Response&);
  void handleTree(const httplib::Request&, httplib::Response&);
  void handleGit(const httplib::Request&, httplib::Response&);
  void handleGitDiff(const httplib::Request&, httplib::Response&);
  void handleGitAction(const httplib::Request&, httplib::Response&);
  void handleBrowserState(const httplib::Request&, httplib::Response&);
  void handleBrowserNavigate(const httplib::Request&, httplib::Response&);
  void handleBrowserEval(const httplib::Request&, httplib::Response&);
  void handleBrowserShot(const httplib::Request&, httplib::Response&);
  void handleBrowserImport(const httplib::Request&, httplib::Response&);
  void handleProjectRename(const httplib::Request&, httplib::Response&);
  void handleProjectApply(const httplib::Request&, httplib::Response&);
  void handleAiOrganize(const httplib::Request&, httplib::Response&);
  void handleAppUpdate(const httplib::Request&, httplib::Response&);
  void handleAppRestart(const httplib::Request&, httplib::Response&);
  void handleUiStateGet(const httplib::Request&, httplib::Response&);
  void handleUiStateSet(const httplib::Request&, httplib::Response&);
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

  // 模型目录 + 会话配置快照 + 预热会话（第一次点模型菜单时创建，随后被首个会话复用）
  mutable   std::mutex modelMu_;
  json modelCatalog_ = json{{"models", json::array()}, {"currentId", ""}};
  json configOptions_ = json::array();
  std::string selectedModel_;
  json spareAcp_ = json::object();

  // CodeBuddy / WorkBuddy 历史项目扫描缓存（workspace 对话框偶尔才打开）
  std::mutex aiRunMu_;
  std::mutex aiTextMu_;
  std::map<std::string, std::string> aiText_;

  mutable std::mutex wsCacheMu_;
  json wsCache_ = json::array();
  int64_t wsCacheAt_ = 0;

  // agent 慢接口的缓存（stats 要扫全部会话，recents 也要扫盘）
  std::mutex remoteMu_;
  json cliStatsCache_ = json::object();
  int64_t cliStatsAt_ = 0;
  std::atomic<bool> cliStatsBusy_{false};
  json recentsCache_ = json::array();
  int64_t recentsAt_ = 0;
  std::atomic<bool> recentsBusy_{false};

  // 当前工作空间：{id, name, folders[]}
  mutable std::mutex wsMu_;
  json activeWorkspace_ = json::object();

  // git status 缓存（右栏会反复拉）
  std::mutex gitMu_;
  json gitCache_ = json::object();
  int64_t gitCacheAt_ = 0;

  // 插件市场：CLI 安装/卸载是长任务，放后台线程，HTTP 只回报 job 状态
  std::mutex marketMu_;
  json demoMarket_ = json::object();
  std::map<std::string, json> marketJobs_;

  // 频道事件游标：每个频道一条 after 游标 + 增量队列，长轮询从这里取。
  // demo 的「接力回复」也走同一个队列，按 dueAt 到期投放，避免后台线程。
  struct TeamWatch {
    bool inited = false;
    std::string after;
    int64_t seq = 0;
    std::deque<json> queue;
  };
  std::mutex teamMu_;
  std::map<std::string, TeamWatch> teamWatches_;
  json demoTeam_ = json::object();

  // 未读游标：readAt 之前视为已读；pending 只存 id/at，不复制消息正文。
  // 首次扫描用整页历史回填（离线期间的新消息因此不会丢），之后只走 after 增量。
  struct TeamUnread {
    bool inited = false;
    bool hasCursor = false;
    std::string after;
    int64_t readAt = 0;
    int64_t lastMessageAt = 0;
    std::deque<json> pending;
  };
  std::mutex teamUnreadMu_;
  std::map<std::string, TeamUnread> teamUnreads_;
  std::map<std::string, int> teamCliUnread_;
  std::vector<std::string> teamChannelIds_;
  int64_t teamUnreadScannedAt_ = 0;
  bool teamReadLoaded_ = false;

  std::function<std::string(const std::string&)> browserEval_;
  std::function<void(const std::string&)> browserNavigate_;
  std::function<std::string()> browserState_;
  std::function<std::string(const std::string&)> browserShot_;
  std::function<std::string()> browserImportCookies_;

  std::mutex exitMu_;
  std::function<void()> exitHook_;
  std::atomic<bool> restarting_{false};
};

}  // namespace wbl
