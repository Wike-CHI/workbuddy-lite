#include "normalize.h"

#include <string>

namespace wbl {
namespace {

// 有些宿主会下发 content: null 或字符串，统一取出文本
// usage_update 里的额度是按秒给的 epoch，转成毫秒给前端统一格式化；
// percent 原样保留（CLI 里就是 0-100）。
json normalizeQuota(const json& q) {
  if (!q.is_object()) return json::object();
  json out = {{"model", jstr(q, "model")}, {"percent", 0.0}, {"resetAt", (int64_t)0}};
  auto it = q.find("percent");
  if (it != q.end() && it->is_number()) out["percent"] = it->get<double>();
  auto r = q.find("reset_at");
  if (r != q.end()) {
    if (r->is_string()) {
      try {
        out["resetAt"] = std::stoll(r->get<std::string>()) * 1000;
      } catch (...) {
      }
    } else if (r->is_number()) {
      out["resetAt"] = r->get<int64_t>() * 1000;
    }
  }
  json shared = jval(q, "shared_models", json::array());
  if (shared.is_array()) out["sharedModels"] = shared;
  return out;
}

std::string textOf(const json& content) {
  std::string text;
  if (content.is_string()) {
    text = content.get<std::string>();
  } else if (content.is_array()) {
    for (const auto& c : content) {
      if (c.is_string()) text += c.get<std::string>();
      else if (c.is_object() && c.contains("text") && c["text"].is_string())
        text += c["text"].get<std::string>();
    }
  } else if (content.is_object() && content.contains("text") && content["text"].is_string()) {
    text = content["text"].get<std::string>();
  }
  return text;
}

}  // namespace

json normalizeContent(const json& content) {
  json out = json::array();
  if (content.is_string()) {
    out.push_back({{"type", "text"}, {"text", content}});
    return out;
  }
  if (!content.is_array()) return out;

  for (const auto& b : content) {
    if (!b.is_object()) {
      out.push_back({{"type", "text"}, {"text", b.is_string() ? b.get<std::string>() : b.dump()}});
      continue;
    }
    std::string t = jstr(b, "type");
    if (t == "diff") {
      out.push_back({{"type", "diff"},
                     {"path", jstr(b, "path")},
                     {"oldText", jstr(b, "oldText")},
                     {"newText", jstr(b, "newText")}});
    } else if (t == "content") {
      out.push_back({{"type", "nested"}, {"block", jval(b, "content", b)}});
    } else if (t == "resource_link") {
      out.push_back({{"type", "link"},
                     {"name", jstr(b, "name", jstr(b, "title"))},
                     {"uri", jstr(b, "uri")}});
    } else if (b.contains("text") && b["text"].is_string()) {
      out.push_back({{"type", "text"}, {"text", b["text"]}});
    } else {
      out.push_back({{"type", t.empty() ? "unknown" : t}, {"block", b}});
    }
  }
  return out;
}

NormalizedEvent normalizeUpdate(const json& update, const std::string& sessionId) {
  NormalizedEvent e;
  if (!update.is_object()) return e;
  std::string kind = jstr(update, "sessionUpdate");
  if (kind.empty()) return e;

  e.valid = true;
  e.data["sessionId"] = sessionId;

  if (kind == "agent_message_chunk") {
    e.type = "text";
    e.data["text"] = textOf(jval(update, "content", json()));
  } else if (kind == "agent_thought_chunk") {
    e.type = "thought";
    e.data["text"] = textOf(jval(update, "content", json()));
  } else if (kind == "user_message_chunk") {
    e.valid = false;  // 用户消息由前端本地回显
  } else if (kind == "tool_call") {
    e.type = "tool";
    e.data["id"] = jstr(update, "toolCallId");
    e.data["title"] = jstr(update, "title", jstr(update, "kind", "工具调用"));
    e.data["kind"] = jstr(update, "kind");
    e.data["status"] = jstr(update, "status", "pending");
    e.data["content"] = normalizeContent(jval(update, "content", json::array()));
    e.data["locations"] = jval(update, "locations", json::array());
    e.data["rawInput"] = jval(update, "rawInput", json());
  } else if (kind == "tool_call_update") {
    e.type = "tool_update";
    e.data["id"] = jstr(update, "toolCallId");
    if (update.contains("title")) e.data["title"] = update["title"];
    if (update.contains("status")) e.data["status"] = update["status"];
    if (update.contains("content")) e.data["content"] = normalizeContent(update["content"]);
    if (update.contains("rawOutput")) e.data["rawOutput"] = update["rawOutput"];
    if (update.contains("locations")) e.data["locations"] = update["locations"];
  } else if (kind == "plan") {
    e.type = "plan";
    e.data["entries"] = jval(update, "entries", json::array());
  } else if (kind == "usage_update") {
    e.type = "usage";
    e.data["used"] = jval(update, "used", json(0));
    e.data["size"] = jval(update, "size", json(0));
    json meta = jval(update, "_meta", json::object());
    if (meta.is_object()) {
      if (meta.contains("codebuddy.ai/usageByCategory"))
        e.data["byCategory"] = meta["codebuddy.ai/usageByCategory"];
      std::string requestId = jstr(meta, "codebuddy.ai/requestId");
      if (!requestId.empty()) e.data["requestId"] = requestId;
      std::string messageId = jstr(meta, "codebuddy.ai/messageId");
      if (!messageId.empty()) e.data["messageId"] = messageId;
      json byRequest = jval(meta, "codebuddy.ai/requestCredits", json::object());
      if (byRequest.is_object() && !byRequest.empty()) e.data["requestCredits"] = byRequest;

      // 这里才是积分真身：credit 是实扣，original_credit 是原价，quota 是额度预算
      json usage = jval(meta, "usage", json::object());
      if (usage.is_object()) {
        e.data["tokens"] = usage;
        if (usage.contains("credit") && usage["credit"].is_number()) e.data["credit"] = usage["credit"];
        if (usage.contains("original_credit") && usage["original_credit"].is_number())
          e.data["originalCredit"] = usage["original_credit"];
        json quota = jval(usage, "quota", json());
        if (quota.is_object() && !quota.empty()) e.data["quota"] = normalizeQuota(quota);
      }
    }
    if (update.contains("cost") && update["cost"].is_object()) e.data["cost"] = update["cost"];
  } else if (kind == "model_update") {
    e.type = "models";
    e.data["models"] = jval(update, "availableModels", json::array());
    e.data["currentId"] = jstr(update, "currentModelId");
  } else if (kind == "config_option_update") {
    e.type = "config";
    e.data["options"] = jval(update, "configOptions", json::array());
  } else if (kind == "current_mode_update") {
    e.type = "mode";
    e.data["mode"] = jstr(update, "currentModeId");
  } else if (kind == "available_commands_update") {
    e.type = "commands";
    e.data["commands"] = jval(update, "availableCommands", json::array());
  } else {
    e.type = "raw_update";
    e.data["kind"] = kind;
    e.data["update"] = update;
  }
  return e;
}

}  // namespace wbl
