// 公共依赖与基础设施：日志、编码转换、ID、事件总线。
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <random>
#include <string>
#include <thread>
#include <vector>

#include "json.hpp"

using json = nlohmann::json;

namespace wbl {

std::wstring utf8ToWide(const std::string& s);
std::string wideToUtf8(const std::wstring& s);
std::string randomId(const char* prefix);
std::string nowIso();
int64_t nowMs();

// 按 UTF-8 字符边界截断，避免切出半个汉字
std::string utf8Truncate(const std::string& s, size_t maxBytes);
// 序列化 JSON：遇到非法 UTF-8 用替换符兜底，绝不抛异常
std::string dumpJson(const json& j);
// base64 解码：忽略换行与空白，遇到非法字符返回已解出的部分
std::string base64Decode(const std::string& in);
// 读字符串字段：字段缺失 / 为 null / 类型不符时回退默认值（json::value 遇 null 会抛）
std::string jstr(const json& o, const char* key, const std::string& def = "");
// 读任意字段：缺失或为 null 时回退默认值
json jval(const json& o, const char* key, json def = json());

// 简单的日志：写文件 + OutputDebugString，避免污染控制台。
void logInit(const std::string& filePath);
void logf(const std::string& msg);

// SSE 事件总线：单进程内所有会话事件按 seq 递增排队，
// 前端用 /api/stream?from=N 断点续传。
struct Event {
  uint64_t seq = 0;
  std::string type;
  std::string sessionId;
  json data;
};

class EventBus {
 public:
  uint64_t push(const std::string& type, const std::string& sessionId, json data);

  // 取 startSeq 之后（含）的前若干条事件；没有新事件时最多等 waitMs。
  std::vector<Event> takeAfter(uint64_t afterSeq, size_t maxItems, int waitMs);

  uint64_t lastSeq() const;

 private:
  mutable std::mutex mu_;
  std::condition_variable cv_;
  std::deque<Event> queue_;
  uint64_t seq_ = 0;
  static constexpr size_t kKeep = 5000;
};

}  // namespace wbl
