#include "mcp_team.h"

#include <windows.h>

#include <cstdio>
#include <cstdlib>
#include <string>

#include "common.h"
#include "httplib.h"

namespace wbl {
namespace {

constexpr const char* kProtocolVersion = "2024-11-05";
constexpr const char* kServerName = "workbuddy-team";
constexpr const char* kServerVersion = "1.0.0";

void trace(const std::string& msg) {
  const std::string line = "[mcp-team] " + msg + "\n";
  fwrite(line.data(), 1, line.size(), stderr);
  fflush(stderr);
}

std::string dataDir() {
  if (const char* v = getenv("WBL_TEAM_DATA"); v && *v) return v;
  if (const char* v = getenv("WORKBUDDY_LITE_DATA"); v && *v) return v;
  const char* base = getenv("LOCALAPPDATA");
  return std::string(base ? base : ".") + "\\WorkBuddyLite";
}

// 端口优先用 session/new 注入的环境变量，其次读应用写的 port.txt。
// 每次解析而不是缓存：壳重启后端口会变。
int teamPort() {
  if (const char* v = getenv("WBL_TEAM_PORT"); v && *v) {
    try {
      return std::stoi(v);
    } catch (...) {
    }
  }
  const std::string path = dataDir() + "\\port.txt";
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) return 0;
  char buf[32] = {0};
  const size_t n = fread(buf, 1, sizeof(buf) - 1, f);
  fclose(f);
  try {
    return std::stoi(std::string(buf, n));
  } catch (...) {
    return 0;
  }
}

struct Reply {
  int status = 0;
  json doc = json::object();
  bool timeout = false;
  std::string error;
};

Reply callTeam(const std::string& method, const std::string& path, const json& body,
               int timeoutSec = 20) {
  Reply out;
  const int port = teamPort();
  if (port <= 0) {
    out.error = "找不到 WorkBuddy 本地服务端口（应用可能没有启动）";
    return out;
  }
  httplib::Client cli("127.0.0.1", port);
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
    out.timeout = res.error() == httplib::Error::Read;
    out.error = out.timeout ? "本地服务响应超时" : "连不上本地服务";
    return out;
  }
  out.status = res->status;
  json doc = json::parse(res->body, nullptr, false);
  out.doc = doc.is_discarded() ? json::object() : doc;
  return out;
}

// MCP 工具的执行失败不是协议错误：用 isError + 文本返回，让模型能看到原因并自行重试。
json textResult(const std::string& text, bool isError = false) {
  json out = {{"content", json::array({{{"type", "text"}, {"text", text}}})}};
  if (isError) out["isError"] = true;
  return out;
}

std::string errText(const json& doc, const Reply& reply) {
  const std::string msg = jstr(doc, "error");
  if (!msg.empty()) return msg;
  if (reply.status != 0) return "本地服务返回 HTTP " + std::to_string(reply.status);
  return reply.error.empty() ? "本地服务没有返回可读的错误" : reply.error;
}

json fromReply(const Reply& reply) {
  if (reply.status == 0) {
    return textResult(reply.error.empty() ? "连不上 WorkBuddy 本地服务" : reply.error, true);
  }
  const bool ok = reply.doc.is_object() && reply.doc.value("ok", reply.status == 200);
  if (!ok) return textResult(errText(reply.doc, reply), true);
  if (!reply.doc.is_object()) return textResult("本地服务返回了非对象响应", true);
  return textResult(dumpJson(reply.doc), false);
}

bool requireString(const json& args, const char* key, std::string& out, std::string& err,
                   bool required = true) {
  if (!args.contains(key) || args[key].is_null()) {
    if (required) err = std::string("缺少参数 ") + key;
    return !required;
  }
  if (!args[key].is_string()) {
    err = std::string("参数 ") + key + " 必须是字符串";
    return false;
  }
  out = args[key].get<std::string>();
  if (required && out.empty()) {
    err = std::string("参数 ") + key + " 不能为空";
    return false;
  }
  return true;
}

bool requireStringArray(const json& args, const char* key, json& out, std::string& err) {
  if (!args.contains(key) || args[key].is_null()) {
    err = std::string("缺少参数 ") + key;
    return false;
  }
  if (!args[key].is_array()) {
    err = std::string("参数 ") + key + " 必须是字符串数组";
    return false;
  }
  out = json::array();
  for (const auto& item : args[key]) {
    if (!item.is_string()) {
      err = std::string("参数 ") + key + " 必须是字符串数组";
      return false;
    }
    const std::string id = item.get<std::string>();
    if (!id.empty()) out.push_back(id);
  }
  if (out.empty()) {
    err = std::string("参数 ") + key + " 不能为空";
    return false;
  }
  return true;
}

std::string agentName(const json& state, const std::string& id) {
  for (const auto& agent : jval(state, "agents", json::array())) {
    if (jstr(agent, "id") == id) return jstr(agent, "name", id);
  }
  return id;
}

std::string formatTeamList(const json& state) {
  const json agents = jval(state, "agents", json::array());
  const json channels = jval(state, "channels", json::array());
  const int maxMembers = jval(state, "channelMaxMembers", json(12)).is_number()
                             ? jval(state, "channelMaxMembers", json(12)).get<int>()
                             : 12;

  std::string out = "频道（" + std::to_string(channels.size()) + "）：\n";
  if (channels.empty()) out += "  （还没有频道）\n";
  for (const auto& channel : channels) {
    if (!channel.is_object()) continue;
    const std::string id = jstr(channel, "id");
    const json members = jval(channel, "memberAgentIds", json::array());
    out += "- " + jstr(channel, "name", "(未命名)") + "  channelId=" + id;
    out += "  成员 " + std::to_string(members.size()) + "/" + std::to_string(maxMembers);
    const std::string lead = jstr(channel, "leadAgentId");
    out += "  组长=" + (lead.empty() ? std::string("用户编排") : agentName(state, lead));
    const std::string preview = jstr(channel, "lastPreview");
    if (!preview.empty()) out += "  最近=\"" + utf8Truncate(preview, 60) + "\"";
    out += "\n";
    for (const auto& member : members) {
      if (!member.is_string()) continue;
      const std::string mid = member.get<std::string>();
      out += "    · " + agentName(state, mid) + "  agentId=" + mid + "\n";
    }
  }

  out += "\n可用 AI 同事（" + std::to_string(agents.size()) + "）：\n";
  if (agents.empty()) out += "  （名册为空）\n";
  for (const auto& agent : agents) {
    if (!agent.is_object()) continue;
    out += "- " + jstr(agent, "name", "(未命名)") + "  agentId=" + jstr(agent, "id");
    const std::string title = jstr(agent, "title");
    if (!title.empty()) out += "  角色=" + title;
    out += "\n";
  }
  return out;
}

json toolList() {
  auto schema = [](json properties, json required) {
    json s = {{"type", "object"}, {"properties", std::move(properties)}};
    s["required"] = std::move(required);
    return s;
  };
  auto strArray = [] {
    json a = {{"type", "array"}, {"items", {{"type", "string"}}}};
    return a;
  };

  json tools = json::array();

  tools.push_back({
      {"name", "team_list"},
      {"description",
       "列出用户所有的群聊频道、每个频道的成员、组长，以及可用的 AI 同事名册（都带 id）。"
       "当用户提到「团队 / 群聊 / 频道 / AI 同事」，或者要建群、拉人、设组长、改人设、发消息"
       "之前需要确认现状时，先调用它。只读，不会修改任何数据。"},
      {"inputSchema", schema(json::object(), json::array())},
      {"annotations", {{"readOnlyHint", true}, {"title", "查看群聊频道与成员"}}},
  });

  tools.push_back({
      {"name", "team_create_channel"},
      {"description",
       "新建一个群聊频道，并把指定 AI 同事拉进去。用户说「建一个 XX 群，拉上 A 和 B」时使用。"
       "频道至少需要 2 个成员，不能超过频道上限；成员 id 先用 team_list 查。"
       "**这是写操作，会修改用户的团队数据。**"},
      {"inputSchema",
       schema({{"name", {{"type", "string"}, {"description", "频道名，最多 30 个字"}}},
               {"memberAgentIds", strArray()}},
              json::array({"name", "memberAgentIds"}))},
      {"annotations", {{"title", "新建群聊频道"}, {"destructiveHint", false}}},
  });

  tools.push_back({
      {"name", "team_add_members"},
      {"description",
       "把若干 AI 同事加入已有频道。用户说「把 C 也拉进这个群」时使用。"
       "会先读频道现状再全量提交成员，频道上限和最少 2 人的校验由本地服务完成。"
       "**这是写操作，会修改用户的团队数据。**"},
      {"inputSchema",
       schema({{"channelId", {{"type", "string"}, {"description", "频道 id"}}},
               {"agentIds", strArray()}},
              json::array({"channelId", "agentIds"}))},
      {"annotations", {{"title", "添加频道成员"}}},
  });

  tools.push_back({
      {"name", "team_remove_members"},
      {"description",
       "把若干 AI 同事移出频道。用户说「把 C 移出这个群」时使用。"
       "移出后少于 2 人会被拒绝。**这是写操作，会修改用户的团队数据。**"},
      {"inputSchema",
       schema({{"channelId", {{"type", "string"}, {"description", "频道 id"}}},
               {"agentIds", strArray()}},
              json::array({"channelId", "agentIds"}))},
      {"annotations", {{"title", "移出频道成员"}}},
  });

  tools.push_back({
      {"name", "team_set_lead"},
      {"description",
       "设置或取消频道组长。agentId 传 null 表示交回用户编排。"
       "用户说「让 A 当组长」或「取消组长」时使用。"
       "**这是写操作，会修改用户的团队数据。**"},
      {"inputSchema",
       schema({{"channelId", {{"type", "string"}, {"description", "频道 id"}}},
               {"agentId", {{"type", {"string", "null"}},
                            {"description", "要设为组长的 agentId；null 表示取消组长"}}}},
              json::array({"channelId"}))},
      {"annotations", {{"title", "设置频道组长"}}},
  });

  tools.push_back({
      {"name", "team_create_agent"},
      {"description",
       "新建一个 AI 同事（bot）。用户说「新建一个安全评审的同事」时使用。"
       "title 是一行角色，description 是人设/职责，会作为该 bot 的系统提示词素材。"
       "建好后可用 team_add_members 拉进频道。**这是写操作，会修改用户的团队数据。**"},
      {"inputSchema",
       schema({{"name", {{"type", "string"}, {"description", "名字，最多 60 个字"}}},
               {"title", {{"type", "string"}, {"description", "一行角色，最多 60 个字"}}},
               {"description",
                {{"type", "string"}, {"description", "人设 / 职责，最多 2000 个字"}}},
               {"model", {{"type", "string"},
                          {"description", "可选，模型 id；不传则用服务端默认"}}}},
              json::array({"name", "title", "description"}))},
      {"annotations", {{"title", "新建 AI 同事"}}},
  });

  tools.push_back({
      {"name", "team_update_agent_prompt"},
      {"description",
       "修改已有 AI 同事的角色（title）或人设（description）。"
       "用户说「把 A 的人设改成……」时使用。只传需要改的字段，不要传空串去清空。"
       "**这是写操作，会修改用户的团队数据，保存后对该 bot 之后的新回复生效。**"},
      {"inputSchema",
       schema({{"agentId", {{"type", "string"}, {"description", "要修改的 agentId"}}},
               {"title", {{"type", "string"}, {"description", "新角色，最多 60 个字"}}},
               {"description",
                {{"type", "string"}, {"description", "新人设 / 职责，最多 2000 个字"}}}},
              json::array({"agentId"}))},
      {"annotations", {{"title", "修改 AI 同事故人设"}}},
  });

  tools.push_back({
      {"name", "team_send_message"},
      {"description",
       "以用户身份在频道里发一条消息。用户说「在 XX 群说……」时使用。"
       "mentionAgentIds 里的成员会被唤醒并开始回答（每个成员都是一次完整 agent run，会消耗额度）；"
       "不传则只落消息、不唤醒任何人。发之前最好先 team_list 确认成员 id。"
       "**这是写操作，会修改用户的团队数据，并可能触发模型计费。**"},
      {"inputSchema",
       schema({{"channelId", {{"type", "string"}, {"description", "频道 id"}}},
               {"text", {{"type", "string"}, {"description", "消息正文"}}},
               {"mentionAgentIds",
                {{"type", "array"},
                 {"items", {{"type", "string"}}},
                 {"description", "可选，要 @ 的成员 agentId 列表"}}}},
              json::array({"channelId", "text"}))},
      {"annotations", {{"title", "在频道里发消息"}}},
  });

  return tools;
}

json callTool(const std::string& name, const json& args) {
  if (name == "team_list") {
    const Reply reply = callTeam("GET", "/api/team/state", json(), 10);
    if (reply.status != 200) {
      return textResult(reply.status == 0 ? reply.error
                                          : "读取频道失败：" + errText(reply.doc, reply),
                        true);
    }
    if (!reply.doc.is_object() || !reply.doc.value("enabled", false)) {
      return textResult("频道服务不可用：" + jstr(reply.doc, "reason", "请稍后重试"), true);
    }
    return textResult(formatTeamList(reply.doc), false);
  }

  if (name == "team_create_channel") {
    std::string err;
    std::string channelName;
    json members;
    if (!requireString(args, "name", channelName, err)) return textResult(err, true);
    if (!requireStringArray(args, "memberAgentIds", members, err)) return textResult(err, true);
    const Reply reply = callTeam(
        "POST", "/api/team/channel",
        json{{"name", channelName}, {"memberAgentIds", members}}, 30);
    return fromReply(reply);
  }

  if (name == "team_add_members" || name == "team_remove_members") {
    std::string err;
    std::string channelId;
    json agentIds;
    if (!requireString(args, "channelId", channelId, err)) return textResult(err, true);
    if (!requireStringArray(args, "agentIds", agentIds, err)) return textResult(err, true);

    const Reply state = callTeam("GET", "/api/team/state", json(), 10);
    if (state.status != 200 || !state.doc.value("enabled", false)) {
      return textResult("频道服务不可用：" + jstr(state.doc, "reason", state.error), true);
    }
    json target = json::object();
    for (const auto& channel : jval(state.doc, "channels", json::array())) {
      if (jstr(channel, "id") == channelId) target = channel;
    }
    if (target.empty()) return textResult("频道不存在或已被删除", true);

    json members = json::array();
    for (const auto& item : jval(target, "memberAgentIds", json::array())) {
      if (item.is_string()) members.push_back(item.get<std::string>());
    }
    auto contains = [&members](const std::string& id) {
      for (const auto& m : members) {
        if (m.is_string() && m.get<std::string>() == id) return true;
      }
      return false;
    };

    if (name == "team_add_members") {
      bool changed = false;
      for (const auto& id : agentIds) {
        const std::string aid = id.get<std::string>();
        if (!contains(aid)) {
          members.push_back(aid);
          changed = true;
        }
      }
      if (!changed) return textResult("这些智能体已经在频道里了，没有改动", false);
    } else {
      json kept = json::array();
      int removed = 0;
      for (const auto& item : members) {
        const std::string mid = item.get<std::string>();
        bool drop = false;
        for (const auto& id : agentIds) {
          if (id.get<std::string>() == mid) drop = true;
        }
        if (drop) {
          removed++;
        } else {
          kept.push_back(mid);
        }
      }
      if (removed == 0) return textResult("这些智能体不在频道里，没有改动", false);
      members = kept;
    }

    json patch = {{"channelId", channelId}, {"memberAgentIds", members}};
    json revision = jval(target, "governanceRevision");
    if (revision.is_number()) patch["expectedRevision"] = revision;
    const Reply reply = callTeam("POST", "/api/team/channel/members", patch, 30);
    return fromReply(reply);
  }

  if (name == "team_set_lead") {
    std::string err;
    std::string channelId;
    if (!requireString(args, "channelId", channelId, err)) return textResult(err, true);
    std::string lead;
    if (args.contains("agentId") && !args["agentId"].is_null()) {
      if (!args["agentId"].is_string()) return textResult("参数 agentId 必须是字符串或 null", true);
      lead = args["agentId"].get<std::string>();
    }
    json body = {{"channelId", channelId}};
    if (lead.empty()) {
      body["leadAgentId"] = nullptr;
    } else {
      body["leadAgentId"] = lead;
    }
    const Reply reply = callTeam("POST", "/api/team/channel/lead", body, 20);
    return fromReply(reply);
  }

  if (name == "team_create_agent") {
    std::string err;
    std::string agentNameValue;
    if (!requireString(args, "name", agentNameValue, err)) return textResult(err, true);
    json body = {{"name", agentNameValue}};
    for (const char* key : {"title", "description", "model"}) {
      std::string value;
      if (!requireString(args, key, value, err, false)) return textResult(err, true);
      if (!value.empty()) body[key] = value;
    }
    const Reply reply = callTeam("POST", "/api/team/agent", body, 20);
    return fromReply(reply);
  }

  if (name == "team_update_agent_prompt") {
    std::string err;
    std::string agentId;
    if (!requireString(args, "agentId", agentId, err)) return textResult(err, true);
    json body = {{"agentId", agentId}};
    for (const char* key : {"title", "description"}) {
      std::string value;
      if (!requireString(args, key, value, err, false)) return textResult(err, true);
      if (!value.empty()) body[key] = value;
    }
    if (!body.contains("title") && !body.contains("description")) {
      return textResult("至少提供 title 或 description 之一", true);
    }
    const Reply reply = callTeam("PATCH", "/api/team/agent", body, 20);
    return fromReply(reply);
  }

  if (name == "team_send_message") {
    std::string err;
    std::string channelId;
    std::string text;
    if (!requireString(args, "channelId", channelId, err)) return textResult(err, true);
    if (!requireString(args, "text", text, err)) return textResult(err, true);
    json mentions = json::array();
    if (args.contains("mentionAgentIds") && !args["mentionAgentIds"].is_null()) {
      if (!requireStringArray(args, "mentionAgentIds", mentions, err)) {
        // 空数组是合法的「不 @ 任何人」，只有类型错误才失败
        if (!args["mentionAgentIds"].is_array()) return textResult(err, true);
        mentions = json::array();
      }
    }
    json body = {{"channelId", channelId}, {"text", text}, {"mentionAgentIds", mentions}};
    const Reply reply = callTeam("POST", "/api/team/send", body, 20);
    return fromReply(reply);
  }

  return json::object();
}

void writeFrame(HANDLE out, const json& msg) {
  const std::string line = msg.dump(-1, ' ', false, json::error_handler_t::replace) + "\n";
  size_t sent = 0;
  while (sent < line.size()) {
    DWORD written = 0;
    if (!WriteFile(out, line.data() + sent, static_cast<DWORD>(line.size() - sent), &written,
                   nullptr) ||
        written == 0) {
      return;
    }
    sent += written;
  }
}

json rpcError(const json& id, int code, const std::string& message) {
  return json{{"jsonrpc", "2.0"}, {"id", id}, {"error", {{"code", code}, {"message", message}}}};
}

json handleMessage(const json& msg, bool& respond) {
  respond = false;
  const bool hasId = msg.contains("id") && !msg["id"].is_null();
  json id = hasId ? msg["id"] : json();
  const std::string method = jstr(msg, "method");
  if (method.empty()) {
    respond = hasId;
    return rpcError(id, -32600, "Invalid Request: missing method");
  }
  if (!hasId) {
    // 通知（notifications/initialized 等）不需要响应
    if (method == "notifications/initialized") trace("client initialized");
    return json::object();
  }
  respond = true;

  if (method == "initialize") {
    json params = jval(msg, "params", json::object());
    std::string requested = jstr(params, "protocolVersion");
    trace("initialize protocolVersion=" + requested);
    return json{{"jsonrpc", "2.0"},
                {"id", id},
                {"result",
                 {{"protocolVersion", kProtocolVersion},
                  {"capabilities", {{"tools", {{"listChanged", false}}}}},
                  {"serverInfo", {{"name", kServerName}, {"version", kServerVersion}}},
                  {"instructions",
                   "这些工具用于管理 WorkBuddy 的群聊频道、成员和 AI 同事故人设。"
                   "写操作会直接修改用户的团队数据；执行前先确认用户确实要这么做，"
                   "需要 id 时先调用 team_list。"}}}};
  }
  if (method == "ping") return json{{"jsonrpc", "2.0"}, {"id", id}, {"result", json::object()}};
  if (method == "tools/list") {
    return json{{"jsonrpc", "2.0"}, {"id", id}, {"result", {{"tools", toolList()}}}};
  }
  if (method == "tools/call") {
    json params = jval(msg, "params", json::object());
    const std::string name = jstr(params, "name");
    if (name.empty()) return rpcError(id, -32602, "Invalid params: missing tool name");
    json args = jval(params, "arguments", json::object());
    if (!args.is_object()) return rpcError(id, -32602, "Invalid params: arguments must be an object");
    trace("tools/call " + name);
    json result = callTool(name, args);
    if (!result.is_object() || result.empty()) {
      return rpcError(id, -32602, "Unknown tool: " + name);
    }
    return json{{"jsonrpc", "2.0"}, {"id", id}, {"result", result}};
  }
  return rpcError(id, -32601, "Method not found: " + method);
}

void processLine(const std::string& line, HANDLE out) {
  json msg = json::parse(line, nullptr, false);
  if (msg.is_discarded()) {
    writeFrame(out, rpcError(json(), -32700, "Parse error"));
    return;
  }
  if (msg.is_array()) {
    if (msg.empty()) {
      writeFrame(out, rpcError(json(), -32600, "Invalid Request: empty batch"));
      return;
    }
    for (const auto& item : msg) {
      bool respond = false;
      json reply = handleMessage(item, respond);
      if (respond) writeFrame(out, reply);
    }
    return;
  }
  bool respond = false;
  json reply = handleMessage(msg, respond);
  if (respond) writeFrame(out, reply);
}

}  // namespace

int runTeamMcpServer() {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  if (!in || in == INVALID_HANDLE_VALUE || !out || out == INVALID_HANDLE_VALUE) {
    trace("stdin/stdout 不可用，退出");
    return 1;
  }
  trace("start port=" + std::to_string(teamPort()) + " data=" + dataDir());

  std::string buf;
  char chunk[8192];
  for (;;) {
    DWORD read = 0;
    if (!ReadFile(in, chunk, sizeof(chunk), &read, nullptr) || read == 0) break;
    buf.append(chunk, read);
    size_t pos = 0;
    while ((pos = buf.find('\n')) != std::string::npos) {
      std::string line = buf.substr(0, pos);
      buf.erase(0, pos + 1);
      if (!line.empty() && line.back() == '\r') line.pop_back();
      if (!line.empty()) processLine(line, out);
    }
    // 单帧上限 8MB：工具参数都很小，超了说明对端发错，丢掉避免吃内存
    if (buf.size() > 8 * 1024 * 1024) {
      trace("frame too large, dropped");
      buf.clear();
    }
  }
  trace("stdin closed, exit");
  return 0;
}

}  // namespace wbl
