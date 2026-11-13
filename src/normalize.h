// 把 ACP 的 session/update 归一化成前端事件。
#pragma once

#include <string>

#include "common.h"

namespace wbl {

struct NormalizedEvent {
  bool valid = false;
  std::string type;
  json data = json::object();
};

// update 为 ACP session/update 里的 update 对象
NormalizedEvent normalizeUpdate(const json& update, const std::string& sessionId);

// 把 ACP 的 content 数组转成前端可渲染的结构（diff / text / nested / link）
json normalizeContent(const json& content);

}  // namespace wbl
