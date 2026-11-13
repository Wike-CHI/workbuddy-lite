#include "common.h"

#include <array>
#include <cstdio>
#include <ctime>

namespace wbl {

std::wstring utf8ToWide(const std::string& s) {
  if (s.empty()) return {};
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
  std::wstring out(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), n);
  return out;
}

std::string wideToUtf8(const std::wstring& s) {
  if (s.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0, nullptr, nullptr);
  std::string out(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), n, nullptr, nullptr);
  return out;
}

std::string randomId(const char* prefix) {
  static std::mt19937_64 rng{std::random_device{}()};
  static std::mutex mu;
  uint64_t v;
  {
    std::lock_guard<std::mutex> lk(mu);
    v = rng();
  }
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%016llx", (unsigned long long)v);
  return std::string(prefix ? prefix : "") + buf;
}

int64_t nowMs() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

std::string utf8Truncate(const std::string& s, size_t maxBytes) {
  if (s.size() <= maxBytes) return s;
  size_t cut = maxBytes;
  while (cut > 0 && (static_cast<unsigned char>(s[cut]) & 0xC0) == 0x80) --cut;
  return s.substr(0, cut);
}

std::string dumpJson(const json& j) {
  return j.dump(-1, ' ', false, json::error_handler_t::replace);
}

std::string base64Decode(const std::string& in) {
  static const std::array<int8_t, 256> table = [] {
    std::array<int8_t, 256> t{};
    t.fill(-1);
    const char* abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (int i = 0; i < 64; ++i) t[static_cast<unsigned char>(abc[i])] = static_cast<int8_t>(i);
    return t;
  }();

  std::string out;
  out.reserve(in.size() * 3 / 4);
  int val = 0, bits = 0;
  for (unsigned char c : in) {
    if (c == '=') break;
    int8_t v = table[c];
    if (v < 0) continue;  // 跳过换行、空白等
    val = (val << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<char>((val >> bits) & 0xFF));
    }
  }
  return out;
}

std::string jstr(const json& o, const char* key, const std::string& def) {
  if (!o.is_object()) return def;
  auto it = o.find(key);
  if (it == o.end() || !it->is_string()) return def;
  return it->get<std::string>();
}

json jval(const json& o, const char* key, json def) {
  if (!o.is_object()) return def;
  auto it = o.find(key);
  if (it == o.end() || it->is_null()) return def;
  return *it;
}

std::string nowIso() {
  std::time_t t = std::time(nullptr);
  std::tm tmv{};
  localtime_s(&tmv, &t);
  char buf[32];
  std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &tmv);
  return buf;
}

namespace {
std::mutex g_logMu;
FILE* g_logFile = nullptr;
}  // namespace

void logInit(const std::string& filePath) {
  std::lock_guard<std::mutex> lk(g_logMu);
  if (g_logFile) return;
  // _SH_DENYWR：允许别的进程读，只独占写，方便排查
  g_logFile = _fsopen(filePath.c_str(), "a", _SH_DENYWR);
}

void logf(const std::string& msg) {
  std::string line = "[" + nowIso() + "] " + msg + "\n";
  OutputDebugStringA(line.c_str());
  std::lock_guard<std::mutex> lk(g_logMu);
  if (g_logFile) {
    std::fputs(line.c_str(), g_logFile);
    std::fflush(g_logFile);
  }
}

uint64_t EventBus::push(const std::string& type, const std::string& sessionId, json data) {
  std::lock_guard<std::mutex> lk(mu_);
  Event e;
  e.seq = ++seq_;
  e.type = type;
  e.sessionId = sessionId;
  e.data = std::move(data);
  if (e.data.is_object() && !e.data.contains("sessionId") && !sessionId.empty()) {
    e.data["sessionId"] = sessionId;
  }
  e.data["seq"] = e.seq;
  queue_.push_back(std::move(e));
  while (queue_.size() > kKeep) queue_.pop_front();
  cv_.notify_all();
  return seq_;
}

std::vector<Event> EventBus::takeAfter(uint64_t afterSeq, size_t maxItems, int waitMs) {
  std::unique_lock<std::mutex> lk(mu_);
  if (queue_.empty() || queue_.back().seq <= afterSeq) {
    if (waitMs > 0) {
      cv_.wait_for(lk, std::chrono::milliseconds(waitMs),
                   [&] { return !queue_.empty() && queue_.back().seq > afterSeq; });
    }
  }
  std::vector<Event> out;
  for (const auto& e : queue_) {
    if (e.seq > afterSeq) {
      out.push_back(e);
      if (out.size() >= maxItems) break;
    }
  }
  return out;
}

uint64_t EventBus::lastSeq() const {
  std::lock_guard<std::mutex> lk(mu_);
  return seq_;
}

}  // namespace wbl
