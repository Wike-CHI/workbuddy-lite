#include "backend.h"

#include <shobjidl.h>

#include <algorithm>
#include <cctype>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <vector>

#include "catalog.h"
#include "normalize.h"

namespace wbl {
namespace {

std::string localAppDir() {
  // 自动化验证时用独立目录，避免污染真实会话；多开也方便隔离
  const char* override = getenv("WORKBUDDY_LITE_DATA");
  if (override && *override) {
    CreateDirectoryA(override, nullptr);
    return override;
  }
  const char* base = getenv("LOCALAPPDATA");
  std::string dir = base ? base : ".";
  dir += "\\WorkBuddyLite";
  CreateDirectoryA(dir.c_str(), nullptr);
  return dir;
}

std::string exeDir() {
  char buf[MAX_PATH] = {0};
  GetModuleFileNameA(nullptr, buf, MAX_PATH);
  std::string p(buf);
  size_t pos = p.find_last_of("\\/");
  return pos == std::string::npos ? "." : p.substr(0, pos);
}

std::string contentTypeFor(const std::string& path) {
  std::string lower = path;
  for (auto& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  auto ends = [&](const char* ext) {
    size_t n = strlen(ext);
    return lower.size() >= n && lower.compare(lower.size() - n, n, ext) == 0;
  };
  if (ends(".html") || ends(".htm")) return "text/html; charset=utf-8";
  if (ends(".js") || ends(".mjs")) return "text/javascript; charset=utf-8";
  if (ends(".css")) return "text/css; charset=utf-8";
  if (ends(".svg")) return "image/svg+xml";
  if (ends(".json")) return "application/json; charset=utf-8";
  if (ends(".png")) return "image/png";
  if (ends(".jpg") || ends(".jpeg")) return "image/jpeg";
  if (ends(".webp")) return "image/webp";
  if (ends(".gif")) return "image/gif";
  if (ends(".bmp")) return "image/bmp";
  if (ends(".avif")) return "image/avif";
  if (ends(".md") || ends(".txt") || ends(".log")) return "text/plain; charset=utf-8";
  if (ends(".csv")) return "text/csv; charset=utf-8";
  if (ends(".pdf")) return "application/pdf";
  // Office Open XML
  if (ends(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ends(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ends(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  // 旧版 Office
  if (ends(".doc")) return "application/msword";
  if (ends(".xls")) return "application/vnd.ms-excel";
  if (ends(".ppt")) return "application/vnd.ms-powerpoint";
  // 视频
  if (ends(".mp4") || ends(".m4v")) return "video/mp4";
  if (ends(".webm")) return "video/webm";
  if (ends(".mov")) return "video/quicktime";
  if (ends(".ogv")) return "video/ogg";
  // 音频
  if (ends(".mp3")) return "audio/mpeg";
  if (ends(".wav")) return "audio/wav";
  if (ends(".m4a")) return "audio/mp4";
  if (ends(".ogg") || ends(".oga")) return "audio/ogg";
  if (ends(".zip")) return "application/zip";
  return "application/octet-stream";
}

// 只接受浏览器 <img> 能直接显示的格式；扩展名跟 mime 走，避免把 jpeg 存成 .png
const char* imageExtFor(const std::string& mime) {
  if (mime == "image/jpeg" || mime == "image/jpg") return ".jpg";
  if (mime == "image/webp") return ".webp";
  if (mime == "image/gif") return ".gif";
  return ".png";
}

std::string truncateTitle(const std::string& text) {
  // 去掉换行、压缩空白
  std::string out;
  bool space = false;
  for (unsigned char c : text) {
    if (c == '\n' || c == '\r' || c == '\t' || c == ' ') {
      space = true;
      continue;
    }
    if (space && !out.empty()) out.push_back(' ');
    space = false;
    out.push_back(static_cast<char>(c));
  }
  // 按码点计数：一个汉字占 3 字节，按字节截会把「12 个字的标题」截成 9 个字
  constexpr size_t kMaxCp = 24;
  size_t i = 0, cp = 0;
  while (i < out.size() && cp < kMaxCp) {
    unsigned char c = static_cast<unsigned char>(out[i]);
    size_t len = 1;
    if ((c & 0xE0) == 0xC0) len = 2;
    else if ((c & 0xF0) == 0xE0) len = 3;
    else if ((c & 0xF8) == 0xF0) len = 4;
    if (i + len > out.size()) len = out.size() - i;
    i += len;
    ++cp;
  }
  if (i < out.size()) {
    while (i > 0 && out[i - 1] == ' ') --i;  // 截断后别把空格留在省略号前
    return out.substr(0, i) + "…";
  }
  return out.empty() ? "新会话" : out;
}

bool isAuthError(const std::string& msg) {
  return msg.find("Authentication required") != std::string::npos ||
         msg.find("登录") != std::string::npos;
}

std::string todayKey() {
  std::time_t t = std::time(nullptr);
  std::tm tmv{};
  localtime_s(&tmv, &t);
  char buf[16];
  std::strftime(buf, sizeof(buf), "%Y-%m-%d", &tmv);
  return buf;
}

double numAt(const json& o, const char* key, double def = 0.0) {
  if (!o.is_object()) return def;
  auto it = o.find(key);
  if (it == o.end() || !it->is_number()) return def;
  return it->get<double>();
}

std::string leafName(const std::string& path) {
  size_t end = path.find_last_not_of("\\/");
  if (end == std::string::npos) return path;
  size_t pos = path.find_last_of("\\/", end);
  return pos == std::string::npos ? path.substr(0, end + 1) : path.substr(pos + 1, end - pos);
}

bool isDirectoryPath(const std::string& path) {
  if (path.empty()) return false;
  DWORD attr = GetFileAttributesW(utf8ToWide(path).c_str());
  return attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

bool isFilePath(const std::string& path) {
  if (path.empty()) return false;
  DWORD attr = GetFileAttributesW(utf8ToWide(path).c_str());
  return attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

std::string canonicalPath(const std::string& path) {
  std::error_code ec;
  auto p = std::filesystem::weakly_canonical(std::filesystem::path(utf8ToWide(path)), ec);
  if (ec) return "";
  return wideToUtf8(p.wstring());
}

std::string pathKey(const std::string& path);

// 只允许读当前工作空间里的文件，挡住 ../ 和绝对路径逃逸
bool isPathInside(const std::string& root, const std::string& target) {
  std::string r = pathKey(canonicalPath(root));
  std::string t = pathKey(canonicalPath(target));
  if (r.empty() || t.empty()) return false;
  return t == r || t.rfind(r + "\\", 0) == 0;
}

std::string pathKey(const std::string& path) {
  std::string s = path;
  for (auto& c : s) {
    if (c == '/') c = '\\';
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  while (s.size() > 1 && s.back() == '\\') s.pop_back();
  return s;
}

bool samePath(const std::string& a, const std::string& b) {
  return !a.empty() && !b.empty() && pathKey(a) == pathKey(b);
}

double parseCreditMultiplier(const std::string& credits) {
  size_t pos = credits.find_first_of("xX×");
  try {
    if (pos != std::string::npos) return std::stod(credits.substr(pos + 1));
    return std::stod(credits);
  } catch (...) {
    return 0.0;
  }
}

json modelEntry(const json& m) {
  json meta = jval(m, "_meta", json::object());
  std::string credits = jstr(meta, "credits", jstr(m, "description"));
  auto flag = [&](const char* key) {
    json v = jval(meta, key, json(false));
    return v.is_boolean() && v.get<bool>();
  };
  return {{"id", jstr(m, "modelId")},
          {"name", jstr(m, "name", jstr(m, "modelId"))},
          {"credits", credits},
          {"multiplier", parseCreditMultiplier(credits)},
          {"maxInputTokens", static_cast<int64_t>(numAt(meta, "maxInputTokens", 0))},
          {"supportsImages", flag("supportsImages")},
          {"supportsReasoning", flag("supportsReasoning")},
          {"effortOptions", jval(meta, "effortOptions", json::array())}};
}

json demoModels() {
  return json::array(
      {{{"id", "deepseek-v4.1-flash"},
        {"name", "DeepSeek-V4.1-Flash"},
        {"credits", "x0.11 credits"},
        {"multiplier", 0.11},
        {"maxInputTokens", 1000000},
        {"supportsImages", true},
        {"supportsReasoning", true},
        {"effortOptions", json::array()}},
       {{"id", "hy4free"},
        {"name", "Hy4"},
        {"credits", "x0.00 credits"},
        {"multiplier", 0.0},
        {"maxInputTokens", 960000},
        {"supportsImages", true},
        {"supportsReasoning", true},
        {"effortOptions", json::array()}},
       {{"id", "hy4std"},
        {"name", "Hy4"},
        {"credits", "x0.29 credits"},
        {"multiplier", 0.29},
        {"maxInputTokens", 960000},
        {"supportsImages", true},
        {"supportsReasoning", true},
        {"effortOptions", json::array()}},
       {{"id", "glm-5.3"},
        {"name", "GLM-5.3"},
        {"credits", "x0.50 credits"},
        {"multiplier", 0.5},
        {"maxInputTokens", 200000},
        {"supportsImages", false},
        {"supportsReasoning", true},
        {"effortOptions", json::array()}}});
}

json loadStoreFile(const std::string& path) {
  std::ifstream in(path);
  if (!in) return json::object();
  std::stringstream ss;
  ss << in.rdbuf();
  json doc = json::parse(ss.str(), nullptr, false);
  if (doc.is_discarded() || !doc.is_object() || !doc.contains("sessions")) return json::object();
  return doc;
}

json readJsonFile(const std::string& path) {
  std::ifstream in(path);
  if (!in) return json::object();
  std::stringstream ss;
  ss << in.rdbuf();
  json doc = json::parse(ss.str(), nullptr, false);
  return (doc.is_discarded() || !doc.is_object()) ? json::object() : doc;
}

json extractJsonObject(const std::string& text) {
  size_t start = text.find('{');
  size_t end = text.rfind('}');
  if (start == std::string::npos || end == std::string::npos || end <= start) return json::object();
  json doc = json::parse(text.substr(start, end - start + 1), nullptr, false);
  return (doc.is_discarded() || !doc.is_object()) ? json::object() : doc;
}

std::string projectsFilePath() { return localAppDir() + "\\projects.json"; }

void saveProjectsDoc(const json& doc) {
  std::string path = projectsFilePath();
  std::string tmp = path + ".tmp";
  HANDLE mtx = CreateMutexA(nullptr, FALSE, "Local\\WorkBuddyLiteProjects");
  if (mtx) WaitForSingleObject(mtx, 5000);
  std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
  if (out) {
    out << dumpJson(doc);
    out.close();
    MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);
  }
  if (mtx) {
    ReleaseMutex(mtx);
    CloseHandle(mtx);
  }
}

// ---------- 轻量设置（记住上次用的工作空间） ----------
std::string settingsPath() { return localAppDir() + "\\settings.json"; }

void saveSetting(const std::string& key, const std::string& value) {
  std::string path = settingsPath();
  std::string tmp = path + ".tmp";
  HANDLE mtx = CreateMutexA(nullptr, FALSE, "Local\\WorkBuddyLiteSettings");
  if (mtx) WaitForSingleObject(mtx, 5000);
  json doc = readJsonFile(path);
  doc[key] = value;
  std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
  if (out) {
    out << dumpJson(doc);
    out.close();
    MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);
  }
  if (mtx) {
    ReleaseMutex(mtx);
    CloseHandle(mtx);
  }
}

// ---------- 工作空间：一个名字 + 最多 5 个文件夹 ----------
constexpr size_t kMaxWorkspaceFolders = 5;

std::string trimStr(const std::string& s) {
  size_t b = s.find_first_not_of(" \t\r\n");
  if (b == std::string::npos) return "";
  size_t e = s.find_last_not_of(" \t\r\n");
  return s.substr(b, e - b + 1);
}

std::string workspacesPath() { return localAppDir() + "\\workspaces.json"; }

json loadWorkspacesDoc() {
  json doc = readJsonFile(workspacesPath());
  json arr = jval(doc, "workspaces", json::array());
  if (!arr.is_array()) arr = json::array();
  return json{{"workspaces", arr}};
}

bool saveWorkspacesDoc(const json& doc) {
  std::string path = workspacesPath();
  std::string tmp = path + ".tmp";
  HANDLE mtx = CreateMutexA(nullptr, FALSE, "Local\\WorkBuddyLiteWorkspaces");
  if (mtx) WaitForSingleObject(mtx, 5000);
  bool ok = false;
  std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
  if (out) {
    out << dumpJson(doc);
    out.close();
    ok = MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING) != 0;
  }
  if (mtx) {
    ReleaseMutex(mtx);
    CloseHandle(mtx);
  }
  return ok;
}

std::vector<std::string> foldersOf(const json& ws) {
  std::vector<std::string> out;
  if (!ws.is_object()) return out;
  json arr = jval(ws, "folders", json::array());
  if (!arr.is_array()) return out;
  for (const auto& f : arr) {
    if (f.is_string() && !f.get<std::string>().empty()) out.push_back(f.get<std::string>());
  }
  return out;
}

// ---------- 事件压缩 ----------
// 流式 text/thought 是逐 token 下发的，原样落盘会让一个会话攒到十几万条、
// 整份 sessions.json 几十 MB：启动要解析几秒，打开会话直接把前端卡死。
// 落盘时把相邻同类文本合并成一条；回放语义不变（前端本来就按顺序拼接）。
constexpr size_t kSessionEventCap = 400;
constexpr size_t kEventMergeLimit = 64 * 1024;

bool mergeStreamingEvent(json& target, const std::string& type, const json& data) {
  if (type != "text" && type != "thought") return false;
  if (!target.is_object() || jstr(target, "type") != type) return false;
  json& d = target["data"];
  if (!d.is_object()) return false;
  if (d.contains("images") || d.contains("connectors")) return false;
  std::string add = jstr(data, "text");
  if (add.empty()) return false;
  std::string cur = jstr(d, "text");
  if (cur.size() + add.size() > kEventMergeLimit) return false;  // 太长就分段，别造一个巨型字符串
  d["text"] = cur + add;
  return true;
}

// 压缩单个会话的事件数组，返回压缩前的条数
size_t compactSessionEvents(json& events, size_t cap) {
  if (!events.is_array() || events.empty()) return 0;
  size_t before = events.size();

  json merged = json::array();
  for (const auto& ev : events) {
    std::string type = jstr(ev, "type");
    json data = jval(ev, "data", json::object());
    if (!merged.empty() && mergeStreamingEvent(merged.back(), type, data)) continue;
    merged.push_back({{"type", type}, {"data", data}});
  }

  if (merged.size() > cap) {
    // 保住最早两条（首条用户消息 + 第一轮结果），其余只留最近的
    size_t head = std::min<size_t>(2, merged.size());
    size_t tail = cap > head ? cap - head : 0;
    json kept = json::array();
    for (size_t i = 0; i < head; ++i) kept.push_back(merged[i]);
    for (size_t i = merged.size() - tail; i < merged.size(); ++i) kept.push_back(merged[i]);
    events = kept;
  } else {
    events = merged;
  }
  return before;
}

std::string homePath() {
  const char* p = getenv("USERPROFILE");
  return p ? p : "";
}

std::string joinPathSafe(const std::string& a, const std::string& b) {
  if (a.empty()) return b;
  if (b.empty()) return a;
  char last = a.back();
  return (last == '\\' || last == '/') ? a + b : a + "\\" + b;
}

// CodeBuddy / WorkBuddy 的 projects/<encoded> 目录里，session jsonl 第一条用户消息带 cwd
std::string firstCwdInProject(const std::string& dir) {
  std::error_code ec;
  std::filesystem::path root(utf8ToWide(dir));
  if (!std::filesystem::is_directory(root, ec)) return "";
  std::vector<std::filesystem::path> files;
  for (const auto& entry : std::filesystem::directory_iterator(root, ec)) {
    if (entry.is_regular_file(ec) && entry.path().extension() == L".jsonl") files.push_back(entry.path());
  }
  if (files.empty()) return "";
  std::sort(files.begin(), files.end());

  int scanned = 0;
  for (const auto& file : files) {
    if (scanned++ >= 3) break;
    std::ifstream in(file.wstring().c_str(), std::ios::binary);
    if (!in) continue;
    std::string line;
    int lines = 0;
    while (std::getline(in, line) && lines++ < 40) {
      if (line.find("\"cwd\"") == std::string::npos) continue;
      json obj = json::parse(line, nullptr, false);
      if (obj.is_discarded() || !obj.is_object()) continue;
      std::string cwd = jstr(obj, "cwd");
      if (!cwd.empty()) return cwd;
    }
  }
  return "";
}

json scanProjectRoot(const std::string& root, const std::string& source,
                     const std::map<std::string, std::string>& displayNames) {
  json out = json::array();
  std::error_code ec;
  std::filesystem::path rootPath(utf8ToWide(root));
  if (!std::filesystem::is_directory(rootPath, ec)) return out;

  std::vector<std::filesystem::path> dirs;
  for (const auto& entry : std::filesystem::directory_iterator(rootPath, ec)) {
    if (entry.is_directory(ec)) dirs.push_back(entry.path());
  }
  std::sort(dirs.begin(), dirs.end());

  int count = 0;
  for (const auto& dir : dirs) {
    if (count >= 100) break;
    std::string cwd = firstCwdInProject(wideToUtf8(dir.wstring()));
    if (cwd.empty() || !isDirectoryPath(cwd)) continue;
    std::string label = leafName(cwd);
    auto it = displayNames.find(pathKey(cwd));
    if (it != displayNames.end() && !it->second.empty()) label = it->second;
    out.push_back({{"path", cwd}, {"label", label}, {"source", source}});
    ++count;
  }
  return out;
}

}  // namespace

Backend::Backend(bool demo, std::string cwd, std::string webRoot, bool fresh)
    : demo_(demo), fresh_(fresh), cwd_(std::move(cwd)), webRoot_(std::move(webRoot)) {
  char buf[MAX_PATH] = {0};
  GetModuleFileNameA(nullptr, buf, MAX_PATH);
  exePath_ = buf;

  initStore();

  // 没显式传 --cwd 时沿用上次的工作空间；带了 --cwd 时优先把它归到所属工作空间
  if (!cwd_.empty() && !isDirectoryPath(cwd_)) cwd_.clear();
  resolveInitialWorkspace();
}

Backend::~Backend() { stop(); }

std::string Backend::currentCwd() const {
  std::lock_guard<std::mutex> lk(cwdMu_);
  return cwd_;
}

std::string Backend::workspaceName() const {
  json ws = activeWorkspaceInfo();
  return jstr(ws, "name", leafName(currentCwd()));
}

json Backend::findWorkspace(const std::string& id) {
  if (id.empty()) return json::object();
  json doc = loadWorkspacesDoc();
  for (const auto& w : jval(doc, "workspaces", json::array())) {
    if (jstr(w, "id") == id) return w;
  }
  return json::object();
}

json Backend::workspaceByFolder(const std::string& path) {
  if (path.empty()) return json::object();
  std::string key = pathKey(path);
  json doc = loadWorkspacesDoc();
  for (const auto& w : jval(doc, "workspaces", json::array())) {
    for (const auto& f : foldersOf(w)) {
      if (pathKey(f) == key) return w;
    }
  }
  return json::object();
}

json Backend::activeWorkspaceInfo() const {
  {
    std::lock_guard<std::mutex> lk(wsMu_);
    if (activeWorkspace_.is_object() && !activeWorkspace_.empty()) return activeWorkspace_;
  }
  std::string cw = currentCwd();
  return json{{"id", ""}, {"name", leafName(cw)}, {"folders", json::array({cw})}};
}

// 切到某个工作空间：cwd 用 folders[0]，除非显式指定了本空间里的另一个文件夹
void Backend::activateWorkspace(const json& ws, bool persist, const std::string& preferredCwd) {
  if (!ws.is_object() || ws.empty()) return;
  auto folders = foldersOf(ws);
  if (folders.empty()) return;

  std::string target = folders[0];
  if (!preferredCwd.empty()) {
    for (const auto& f : folders) {
      if (pathKey(f) == pathKey(preferredCwd)) {
        target = f;
        break;
      }
    }
  }
  {
    std::lock_guard<std::mutex> lk(wsMu_);
    activeWorkspace_ = ws;
  }
  {
    std::lock_guard<std::mutex> lk(cwdMu_);
    cwd_ = target;
  }
  {
    std::lock_guard<std::mutex> lk(modelMu_);
    spareAcp_ = json::object();
  }
  if (persist) {
    saveSetting("lastWorkspace", target);
    saveSetting("lastWorkspaceId", jstr(ws, "id"));
  }
  logf("工作空间 -> " + jstr(ws, "name", leafName(target)) + " (" + target + ")");
}

void Backend::resolveInitialWorkspace() {
  std::string explicitPath;
  {
    std::lock_guard<std::mutex> lk(cwdMu_);
    explicitPath = cwd_;
  }

  json target;
  if (!explicitPath.empty()) {
    target = workspaceByFolder(explicitPath);
    if (target.empty()) {
      target = {{"id", ""}, {"name", leafName(explicitPath)}, {"folders", json::array({explicitPath})}};
    }
    activateWorkspace(target, true, explicitPath);
    return;
  }

  json settings = readJsonFile(settingsPath());
  std::string lastId = jstr(settings, "lastWorkspaceId");
  if (!lastId.empty()) target = findWorkspace(lastId);
  if (target.empty()) {
    std::string last = jstr(settings, "lastWorkspace");
    if (!last.empty() && isDirectoryPath(last)) target = workspaceByFolder(last);
    if (target.empty() && !last.empty() && isDirectoryPath(last)) {
      target = {{"id", ""}, {"name", leafName(last)}, {"folders", json::array({last})}};
    }
  }
  if (target.empty()) {
    // 没记过偏好时跟随最近一次会话所在目录，最后才退回 exe 目录
    std::string recent;
    int64_t at = 0;
    auto arrIt = store_.find("sessions");
    if (arrIt != store_.end() && arrIt->is_array()) {
      for (const auto& s : *arrIt) {
        if (!s.is_object()) continue;
        std::string c = jstr(s, "cwd");
        int64_t t = s.value("updatedAt", static_cast<int64_t>(0));
        if (t >= at && !c.empty() && isDirectoryPath(c)) {
          at = t;
          recent = c;
        }
      }
    }
    std::string dir = recent.empty() ? exeDir() : recent;
    target = {{"id", ""}, {"name", leafName(dir)}, {"folders", json::array({dir})}};
  }
  activateWorkspace(target, false);
}

void Backend::initStore() {
  json doc = loadStoreFile(localAppDir() + "\\sessions.json");
  if (doc.is_object() && !doc.empty()) {
    store_ = doc;
  } else {
    store_ = json{{"sessions", json::array()}, {"lastSessionId", ""}};
  }

  // 一次性把历史里逐 token 落盘的事件压掉（老版本升级上来的数据）
  size_t before = 0, after = 0;
  json& arr = store_["sessions"];
  if (arr.is_array()) {
    for (auto& s : arr) {
      if (!s.is_object()) continue;
      json& evs = s["events"];
      if (!evs.is_array() || evs.empty()) continue;
      before += compactSessionEvents(evs, kSessionEventCap);
      after += evs.size();
    }
  }
  if (before != after) {
    logf("会话事件压缩 " + std::to_string(before) + " -> " + std::to_string(after));
    saveStore();
  }
}

void Backend::saveStore() {
  json snapshot;
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    snapshot = store_;
  }
  std::string path = localAppDir() + "\\sessions.json";
  std::string tmp = path + ".tmp";

  // 多窗口是多个进程，各自持有一份内存 store。这里用命名互斥锁串行化写入，
  // 并把磁盘上的新会话合并进来，避免后写的窗口把先写的整份覆盖掉。
  HANDLE mtx = CreateMutexA(nullptr, FALSE, "Local\\WorkBuddyLiteStore");
  if (mtx) WaitForSingleObject(mtx, 5000);

  json disk = loadStoreFile(path);
  std::map<std::string, json> byId;
  for (const auto& s : jval(disk, "sessions", json::array())) {
    std::string id = jstr(s, "id");
    if (!id.empty()) byId[id] = s;
  }
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    for (const auto& id : deletedIds_) byId.erase(id);
  }
  for (const auto& s : jval(snapshot, "sessions", json::array())) {
    std::string id = jstr(s, "id");
    if (id.empty()) continue;
    auto it = byId.find(id);
    if (it == byId.end() ||
        s.value("updatedAt", static_cast<int64_t>(0)) >=
            it->second.value("updatedAt", static_cast<int64_t>(0))) {
      byId[id] = s;
    }
  }

  std::vector<json> list;
  list.reserve(byId.size());
  for (auto& [id, s] : byId) list.push_back(s);
  std::sort(list.begin(), list.end(), [](const json& a, const json& b) {
    return a.value("updatedAt", static_cast<int64_t>(0)) <
           b.value("updatedAt", static_cast<int64_t>(0));
  });
  json merged = {{"sessions", json::array()},
                 {"lastSessionId", jstr(snapshot, "lastSessionId", jstr(disk, "lastSessionId"))}};
  for (auto& s : list) merged["sessions"].push_back(s);

  std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
  if (out) {
    out << dumpJson(merged);
    out.close();
    MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);
  }

  {
    std::lock_guard<std::mutex> lk(storeMu_);
    store_ = merged;
    deletedIds_.clear();
  }
  if (mtx) {
    ReleaseMutex(mtx);
    CloseHandle(mtx);
  }
}

bool Backend::start() {
  setupRoutes();
  port_ = srv_.bind_to_any_port("127.0.0.1");
  if (port_ <= 0) {
    logf("bind_to_any_port 失败");
    return false;
  }
  listenThread_ = std::thread([this] { srv_.listen_after_bind(); });
  logf("http server on " + url());

  // 预热 Agent（演示模式跳过）
  if (!demo_) {
    std::string err;
    std::thread([this] {
      std::string e;
      if (!ensureAgent(e)) {
        logf("agent 预热失败: " + e);
        return;
      }
      // 顺手把两个慢接口预热，界面第一次打开用量/工作空间就能直接命中缓存
      agentRecents();
      cliStats();
    }).detach();
  }
  return true;
}

void Backend::stop() {
  if (stopped_.exchange(true)) return;
  srv_.stop();
  if (listenThread_.joinable()) listenThread_.join();
  saveStore();
  if (client_) client_->close();
  if (host_) host_->stop();
}

std::string Backend::statusText() const {
  if (demo_) return "演示模式";
  if (agentReady_) return "已连接 CodeBuddy";
  return agentError_.empty() ? "正在启动 Agent…" : agentError_;
}

bool Backend::ensureAgent(std::string& err) {
  std::lock_guard<std::mutex> lk(agentMu_);
  if (client_ && client_->isOpen()) {
    agentReady_ = true;
    return true;
  }
  try {
    if (!host_) host_ = std::make_unique<AgentHost>();
    if (!host_->ready()) host_->start();
    if (!client_) client_ = std::make_unique<AcpClient>();
    if (!client_->isOpen()) {
      client_->open(host_->baseUrl());
      wireAgentCallbacks();
      // 重连后旧的预热会话已经失效，别拿去发 prompt
      std::lock_guard<std::mutex> ml(modelMu_);
      spareAcp_ = json::object();
    }
    agentReady_ = true;
    agentError_.clear();
    return true;
  } catch (const std::exception& e) {
    agentReady_ = false;
    agentError_ = e.what();
    err = agentError_;
    logf(std::string("ensureAgent 失败: ") + e.what());
    return false;
  }
}

void Backend::wireAgentCallbacks() {
  if (!client_) return;
  client_->onUpdate([this](const json& update, const std::string& acpSid) {
    NormalizedEvent ev = normalizeUpdate(update, acpSid);
    if (!ev.valid) return;
    if (ev.type == "text") {
      // AI 整理用临时会话：文本不进 UI，只在这里收集
      std::lock_guard<std::mutex> lk(aiTextMu_);
      auto it = aiText_.find(acpSid);
      if (it != aiText_.end()) it->second += jstr(ev.data, "text");
    }
    if (ev.type == "config") {
      // 顺手记下当前模型；configOptions 里也带 model 的完整选项
      for (const auto& opt : jval(ev.data, "options", json::array())) {
        if (jstr(opt, "id") == "model") {
          std::string cur = jstr(opt, "currentValue");
          if (!cur.empty()) {
            std::lock_guard<std::mutex> lk(modelMu_);
            if (selectedModel_.empty()) selectedModel_ = cur;
          }
        }
      }
    } else if (ev.type == "models") {
      // ACP 主动推送的模型目录（切换/刷新时）
      json arr = jval(ev.data, "models", json::array());
      if (arr.is_array() && !arr.empty()) setModelCatalog(arr, jstr(ev.data, "currentId"));
    }
    std::string uiId;
    {
      std::lock_guard<std::mutex> lk(mapMu_);
      auto it = acpToUi_.find(acpSid);
      if (it != acpToUi_.end()) uiId = it->second;
    }
    if (uiId.empty()) return;
    // normalize 打的是 ACP 会话 id，前端只认 UI 会话 id；这里统一改写成 UI id，
    // 否则带 sessionId 的载荷（例如 usage）会被前端当成别的会话整条丢掉
    ev.data["sessionId"] = uiId;
    emit(uiId, ev.type, ev.data);
  });

  client_->onAgentRequest([this](int64_t id, const std::string& method, const json& params) {
    if (method != "session/request_permission") {
      client_->reply(id, json::object());
      return;
    }
    std::string acpSid = jstr(params, "sessionId");
    std::string uiId;
    {
      std::lock_guard<std::mutex> lk(mapMu_);
      auto it = acpToUi_.find(acpSid);
      if (it != acpToUi_.end()) uiId = it->second;
    }
    if (uiId.empty()) {
      client_->reply(id, json{{"outcome", {{"outcome", "cancelled"}}}});
      return;
    }
    std::string requestId = "perm_" + std::to_string(id);
    {
      std::lock_guard<std::mutex> lk(mapMu_);
      pendingPerm_[requestId] = {id, uiId};
    }
    json toolCall = jval(params, "toolCall", json::object());
    json options = json::array();
    for (const auto& o : jval(params, "options", json::array())) {
      options.push_back({{"optionId", jstr(o, "optionId")},
                         {"name", jstr(o, "name", jstr(o, "optionId"))},
                         {"kind", jstr(o, "kind")}});
    }
    emit(uiId, "permission",
         json{{"requestId", requestId},
              {"title", jstr(toolCall, "title", "需要授权")},
              {"kind", jstr(toolCall, "kind")},
              {"toolCallId", jstr(toolCall, "toolCallId")},
              {"options", options}});
  });
}

std::string Backend::selectedModel() const {
  std::lock_guard<std::mutex> lk(modelMu_);
  return selectedModel_;
}

void Backend::setModelCatalog(const json& availableModels, const std::string& currentId) {
  json list = json::array();
  if (availableModels.is_array()) {
    for (const auto& m : availableModels) {
      if (m.is_object()) list.push_back(modelEntry(m));
    }
  }
  if (list.empty()) return;
  std::lock_guard<std::mutex> lk(modelMu_);
  modelCatalog_ = {{"models", list}, {"currentId", currentId}};
  if (selectedModel_.empty() && !currentId.empty()) selectedModel_ = currentId;
}

void Backend::absorbSessionInfo(const json& info, const std::string& uiId) {
  if (!info.is_object()) return;
  json models = jval(info, "models", json::object());
  if (models.is_object()) {
    json available = jval(models, "availableModels", json::array());
    setModelCatalog(available, jstr(models, "currentModelId"));
  }
  json configOptions = jval(info, "configOptions", json::array());
  if (configOptions.is_array() && !configOptions.empty() && !uiId.empty()) {
    emit(uiId, "config", json{{"options", configOptions}});
  }
}

json Backend::takeSpareSession(const std::string& cwd) {
  std::lock_guard<std::mutex> lk(modelMu_);
  if (!spareAcp_.is_object() || spareAcp_.empty()) return json::object();
  if (!samePath(jstr(spareAcp_, "cwd"), cwd)) return json::object();
  json info = jval(spareAcp_, "info", json::object());
  spareAcp_ = json::object();
  return info;
}

bool Backend::ensureModelCatalog(std::string& err) {
  if (demo_) {
    std::lock_guard<std::mutex> lk(modelMu_);
    modelCatalog_ = {{"models", demoModels()}, {"currentId", "deepseek-v4.1-flash"}};
    if (selectedModel_.empty()) selectedModel_ = "deepseek-v4.1-flash";
    return true;
  }
  {
    std::lock_guard<std::mutex> lk(modelMu_);
    if (!jval(modelCatalog_, "models", json::array()).empty()) return true;
  }

  const std::string cwd = currentCwd();
  json info = json::object();
  {
    std::lock_guard<std::mutex> lk(modelMu_);
    if (!spareAcp_.is_object() || spareAcp_.empty() || !samePath(jstr(spareAcp_, "cwd"), cwd)) {
      // 没有可复用会话
    } else {
      info = jval(spareAcp_, "info", json::object());
    }
  }
  if (!info.is_object() || info.empty()) {
    if (!ensureAgent(err)) return false;
    try {
      info = client_->newSessionInfo(cwd);
    } catch (const std::exception& e) {
      err = e.what();
      return false;
    }
    if (!info.is_object() || info.empty()) {
      err = "读取模型目录失败";
      return false;
    }
    std::lock_guard<std::mutex> lk(modelMu_);
    spareAcp_ = {{"cwd", cwd}, {"info", info}};
  }
  absorbSessionInfo(info, "");
  return true;
}

json Backend::latestQuota() {
  json quota = json::object();
  int64_t best = 0;
  std::lock_guard<std::mutex> lk(storeMu_);
  for (const auto& s : jval(store_, "sessions", json::array())) {
    json u = jval(s, "usage", json::object());
    json q = jval(u, "quota", json::object());
    if (!q.is_object() || q.empty()) continue;
    json last = jval(u, "lastTurn", json::object());
    int64_t at = static_cast<int64_t>(numAt(last, "at", 0));
    if (at == 0) at = s.value("updatedAt", static_cast<int64_t>(0));
    if (at >= best) {
      best = at;
      quota = q;
    }
  }
  return quota;
}

json Backend::usageSummary() {
  const std::string cw = currentCwd();
  const std::string today = todayKey();
  double totalCredits = 0, totalCharged = 0, todayCredits = 0;
  double workspaceCredits = 0, workspaceCharged = 0, workspaceToday = 0;
  json list = json::array();
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    auto arrIt = store_.find("sessions");
    if (arrIt != store_.end() && arrIt->is_array()) {
      for (const auto& s : *arrIt) {
        json u = jval(s, "usage", json::object());
        double credits = numAt(u, "credits", 0);
        double charged = numAt(u, "charged", 0);
        double todayCredit = 0;
        json daily = jval(u, "daily", json::object());
        if (daily.is_object()) todayCredit = numAt(daily, today.c_str(), 0);
        totalCredits += credits;
        totalCharged += charged;
        todayCredits += todayCredit;
        bool here = samePath(jstr(s, "cwd"), cw);
        if (here) {
          workspaceCredits += credits;
          workspaceCharged += charged;
          workspaceToday += todayCredit;
        }
        list.push_back({{"id", jstr(s, "id")},
                        {"title", jstr(s, "title", "新会话")},
                        {"cwd", jstr(s, "cwd")},
                        {"credits", credits},
                        {"charged", charged},
                        {"updatedAt", s.value("updatedAt", static_cast<int64_t>(0))},
                        {"inWorkspace", here}});
      }
    }
  }
  std::sort(list.begin(), list.end(), [](const json& a, const json& b) {
    return numAt(a, "credits", 0) > numAt(b, "credits", 0);
  });
  json top = json::array();
  for (size_t i = 0; i < list.size() && i < 8; ++i) top.push_back(list[i]);

  json out = {{"workspace", cw},
              {"totalCredits", totalCredits},
              {"totalCharged", totalCharged},
              {"todayCredits", todayCredits},
              {"workspaceCredits", workspaceCredits},
              {"workspaceCharged", workspaceCharged},
              {"workspaceToday", workspaceToday},
              {"sessions", top},
              {"quota", latestQuota()},
              {"model", selectedModel()}};

  if (!demo_) {
    json stats = cliStats();
    if (stats.is_object() && !stats.empty()) {
      auto sv = [&](const char* key) -> int64_t {
        auto it = stats.find(key);
        return (it != stats.end() && it->is_number()) ? it->get<int64_t>() : 0;
      };
      out["cliStats"] = {{"totalSessions", sv("totalSessions")},
                         {"totalMessages", sv("totalMessages")},
                         {"totalDays", sv("totalDays")},
                         {"activeDays", sv("activeDays")},
                         {"modelUsage", jval(stats, "modelUsage", json::object())}};
    }
  }
  return out;
}

json Backend::agentGet(const std::string& path) {
  if (!host_ || !host_->ready()) return json::object();
  try {
    httplib::Client cli(host_->baseUrl());
    cli.set_connection_timeout(2, 0);
    cli.set_read_timeout(8, 0);
    auto res = cli.Get(path.c_str(), httplib::Headers{{"X-CodeBuddy-Request", "1"}});
    if (!res || res->status != 200) return json::object();
    json doc = json::parse(res->body, nullptr, false);
    if (doc.is_discarded() || !doc.is_object()) return json::object();
    json data = jval(doc, "data", json());
    if (data.is_object() || data.is_array()) return data;
    return doc;
  } catch (...) {
    return json::object();
  }
}

// /api/v1/stats 会扫全部历史会话，实测 0.9–1.2s；前端每轮对话要读好几次用量。
// 这里缓存 60s，过期后返回旧值并在后台刷新，避免把 httplib 的线程池占满。
json Backend::cliStats() {
  const int64_t now = nowMs();
  bool haveCache = false;
  {
    std::lock_guard<std::mutex> lk(remoteMu_);
    haveCache = cliStatsCache_.is_object() && !cliStatsCache_.empty();
    if (haveCache && now - cliStatsAt_ < 60000) return cliStatsCache_;
  }
  if (!cliStatsBusy_.exchange(true)) {
    if (!haveCache) {
      // 首次没有旧值，只能同步等一次
      json fresh = agentGet("/api/v1/stats");
      std::lock_guard<std::mutex> lk(remoteMu_);
      if (fresh.is_object() && !fresh.empty()) {
        cliStatsCache_ = fresh;
        cliStatsAt_ = nowMs();
      }
      cliStatsBusy_ = false;
      return cliStatsCache_;
    }
    std::thread([this] {
      json fresh = agentGet("/api/v1/stats");
      {
        std::lock_guard<std::mutex> lk(remoteMu_);
        if (fresh.is_object() && !fresh.empty()) {
          cliStatsCache_ = fresh;
          cliStatsAt_ = nowMs();
        }
      }
      cliStatsBusy_ = false;
    }).detach();
  }
  std::lock_guard<std::mutex> lk(remoteMu_);
  return cliStatsCache_;
}

// /api/v1/sessions/workspaces 同样是现算的，工作空间面板打开一次要等半秒
json Backend::agentRecents() {
  const int64_t now = nowMs();
  bool haveCache = false;
  {
    std::lock_guard<std::mutex> lk(remoteMu_);
    haveCache = !recentsCache_.empty();
    if (haveCache && now - recentsAt_ < 60000) return recentsCache_;
  }
  if (!recentsBusy_.exchange(true)) {
    if (!haveCache) {
      json fresh = agentGet("/api/v1/sessions/workspaces");
      std::lock_guard<std::mutex> lk(remoteMu_);
      if (fresh.is_object() && !fresh.empty()) {
        recentsCache_ = fresh;
        recentsAt_ = nowMs();
      }
      recentsBusy_ = false;
      return recentsCache_;
    }
    std::thread([this] {
      json fresh = agentGet("/api/v1/sessions/workspaces");
      {
        std::lock_guard<std::mutex> lk(remoteMu_);
        if (fresh.is_object() && !fresh.empty()) {
          recentsCache_ = fresh;
          recentsAt_ = nowMs();
        }
      }
      recentsBusy_ = false;
    }).detach();
  }
  std::lock_guard<std::mutex> lk(remoteMu_);
  return recentsCache_;
}

json Backend::scannedWorkspaces() {
  const int64_t now = nowMs();
  {
    std::lock_guard<std::mutex> lk(wsCacheMu_);
    if (wsCache_.is_array() && now - wsCacheAt_ < 60000) return wsCache_;
  }

  const std::string home = homePath();
  if (home.empty()) return json::array();

  std::map<std::string, std::string> displayNames;
  json namesDoc = readJsonFile(joinPathSafe(home, ".workbuddy\\workspace-display-names.json"));
  json names = jval(namesDoc, "workspaces", json::object());
  if (names.is_object()) {
    for (auto it = names.begin(); it != names.end(); ++it) {
      std::string path = jstr(it.value(), "path", it.key());
      std::string name = jstr(it.value(), "displayName");
      if (!path.empty() && !name.empty()) displayNames[pathKey(path)] = name;
    }
  }

  json out = json::array();
  for (const auto& w : scanProjectRoot(joinPathSafe(home, ".codebuddy\\projects"), "codebuddy", displayNames)) {
    out.push_back(w);
  }
  for (const auto& w : scanProjectRoot(joinPathSafe(home, ".workbuddy\\projects"), "workbuddy", displayNames)) {
    out.push_back(w);
  }

  std::lock_guard<std::mutex> lk(wsCacheMu_);
  wsCache_ = out;
  wsCacheAt_ = now;
  return out;
}

std::string Backend::runOrganizerPrompt(const std::string& prompt, std::string& err) {
  if (demo_) {
    err = "演示模式没有模型，不能做 AI 整理";
    return "";
  }
  std::lock_guard<std::mutex> run(aiRunMu_);
  if (!ensureAgent(err)) return "";

  std::string sid;
  try {
    json info = client_->newSessionInfo(currentCwd());
    sid = jstr(info, "sessionId");
  } catch (const std::exception& e) {
    err = e.what();
    return "";
  }
  if (sid.empty()) {
    err = "创建临时整理会话失败";
    return "";
  }
  {
    std::lock_guard<std::mutex> lk(aiTextMu_);
    aiText_[sid] = "";
  }

  bool ok = true;
  try {
    std::string model = selectedModel();
    if (!model.empty()) client_->setConfigOption(sid, "model", model);
    client_->prompt(sid, prompt, json::array(), 180);
  } catch (const std::exception& e) {
    err = e.what();
    ok = false;
  }

  std::string text;
  {
    std::lock_guard<std::mutex> lk(aiTextMu_);
    auto it = aiText_.find(sid);
    if (it != aiText_.end()) text = it->second;
    aiText_.erase(sid);
  }
  try {
    client_->request("session/delete", {{"sessionId", sid}}, 15);
  } catch (...) {
    try {
      client_->request("session/close", {{"sessionId", sid}}, 15);
    } catch (...) {
    }
  }
  if (!ok) return "";
  if (text.empty()) {
    err = "模型没有返回内容";
    return "";
  }
  return text;
}

json Backend::workspaceList() {
  const std::string cw = currentCwd();
  json list = json::array();
  std::set<std::string> seen;
  auto add = [&](const std::string& path, const std::string& label, const std::string& source) {
    if (path.empty() || !isDirectoryPath(path)) return;
    std::string key = pathKey(path);
    if (!seen.insert(key).second) return;
    list.push_back({{"path", path},
                    {"label", label.empty() ? leafName(path) : label},
                    {"source", source},
                    {"current", samePath(path, cw)}});
  };

  add(cw, leafName(cw), "current");

  // 自建工作空间优先：带完整文件夹列表，界面上可以编辑
  const std::string activeId = jstr(activeWorkspaceInfo(), "id");
  {
    json doc = loadWorkspacesDoc();
    for (const auto& w : jval(doc, "workspaces", json::array())) {
      auto folders = foldersOf(w);
      if (folders.empty() || !isDirectoryPath(folders[0])) continue;
      std::string key = pathKey(folders[0]);
      if (!seen.insert(key).second) continue;
      std::string id = jstr(w, "id");
      list.push_back({{"id", id},
                      {"path", folders[0]},
                      {"label", jstr(w, "name", leafName(folders[0]))},
                      {"source", "custom"},
                      {"folders", folders},
                      {"active", !id.empty() && id == activeId},
                      {"current", samePath(folders[0], cw)}});
    }
  }
  if (!demo_) {
    json ws = agentRecents();
    for (const auto& w : jval(ws, "workspaces", json::array())) {
      add(jstr(w, "path"), jstr(w, "label"), "recent");
    }
  }
  for (const auto& w : scannedWorkspaces()) {
    add(jstr(w, "path"), jstr(w, "label"), jstr(w, "source"));
  }
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    auto arrIt = store_.find("sessions");
    if (arrIt != store_.end() && arrIt->is_array()) {
      for (const auto& s : *arrIt) {
        std::string cwd = jstr(s, "cwd");
        add(cwd, leafName(cwd), "session");
      }
    }
  }
  for (const auto& d : listSubdirs(cw, 30)) {
    add(jstr(d, "path"), jstr(d, "name"), "subdir");
  }
  // 用户自己建的/改过名字的项目：即使还没有会话，也要在列表里
  {
    json doc = readJsonFile(projectsFilePath());
    json projects = jval(doc, "projects", json::object());
    if (projects.is_object()) {
      for (auto it = projects.begin(); it != projects.end(); ++it) {
        add(jstr(it.value(), "path"), jstr(it.value(), "name"), "custom");
      }
    }
  }
  json active = activeWorkspaceInfo();
  return json{{"cwd", cw},
              {"workspace", jstr(active, "name", leafName(cw))},
              {"workspaceId", jstr(active, "id")},
              {"workspaceName", jstr(active, "name", leafName(cw))},
              {"workspaceFolders", foldersOf(active)},
              {"agentReady", agentReady_.load()},
              {"demo", demo_},
              {"workspaces", list}};
}

bool Backend::spawnWindow(const std::string& path) {
  if (exePath_.empty() || !isDirectoryPath(path)) return false;
  std::wstring exe = utf8ToWide(exePath_);
  std::wstring dir = utf8ToWide(path);
  std::wstring cmd = L"\"" + exe + L"\" --cwd \"" + dir + L"\" --new-window";
  STARTUPINFOW si{};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi{};
  std::vector<wchar_t> buf(cmd.begin(), cmd.end());
  buf.push_back(L'\0');
  BOOL ok = CreateProcessW(nullptr, buf.data(), nullptr, nullptr, FALSE, 0, nullptr, dir.c_str(), &si, &pi);
  if (!ok) {
    logf("spawn window 失败 code=" + std::to_string(GetLastError()));
    return false;
  }
  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);
  return true;
}

std::string Backend::pickFolder() {
  std::string out;
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
  bool uninit = SUCCEEDED(hr);
  IFileOpenDialog* dlg = nullptr;
  hr = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_ALL, IID_PPV_ARGS(&dlg));
  if (SUCCEEDED(hr) && dlg) {
    DWORD opts = 0;
    dlg->GetOptions(&opts);
    dlg->SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    if (SUCCEEDED(dlg->Show(GetForegroundWindow()))) {
      IShellItem* item = nullptr;
      if (SUCCEEDED(dlg->GetResult(&item)) && item) {
        PWSTR p = nullptr;
        if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &p)) && p) {
          out = wideToUtf8(p);
          CoTaskMemFree(p);
        }
        item->Release();
      }
    }
    dlg->Release();
  }
  if (uninit) CoUninitialize();
  return out;
}

json* Backend::findSession(const std::string& uiId) {
  auto& arr = store_["sessions"];
  for (auto& s : arr) {
    if (jstr(s, "id") == uiId) return &s;
  }
  return nullptr;
}

json Backend::createSession(const std::string& cwd, const std::string& title) {
  json s = {{"id", randomId("s_")},
            {"title", title.empty() ? "新会话" : title},
            {"cwd", cwd.empty() ? currentCwd() : cwd},
            {"acpSessionId", ""},
            {"model", selectedModel()},
            {"mode", "fullAccess"},
            {"createdAt", nowMs()},
            {"updatedAt", nowMs()},
            {"events", json::array()},
            {"usage", {{"used", 0}, {"size", 0}, {"credits", 0.0}, {"charged", 0.0}}}};
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    store_["sessions"].push_back(s);
    store_["lastSessionId"] = s["id"];
  }
  saveStore();
  return s;
}

// 同一轮可能连发多条 usage_update，按 requestId 取最大值再算增量，
// 否则每条都累加会把积分翻好几倍。
void Backend::mergeUsage(json& session, const json& data) {
  json u = jval(session, "usage", json::object());
  if (!u.is_object()) u = json::object();
  if (data.contains("used")) u["used"] = data["used"];
  if (data.contains("size")) u["size"] = data["size"];

  double nominal = numAt(data, "originalCredit", -1);
  if (nominal < 0) nominal = numAt(data, "credit", 0);
  double actual = numAt(data, "credit", 0);
  if (actual <= 0 && data.contains("cost") && data["cost"].is_object())
    actual = numAt(data["cost"], "amount", 0);
  if (nominal <= 0 && actual > 0) nominal = actual;

  if (nominal > 0 || actual > 0) {
    std::string rid = jstr(data, "requestId");
    json byReq = jval(u, "byRequest", json::object());
    if (!byReq.is_object()) byReq = json::object();

    double prevNominal = 0, prevActual = 0;
    if (!rid.empty() && byReq.contains(rid) && byReq[rid].is_object()) {
      prevNominal = numAt(byReq[rid], "nominal", 0);
      prevActual = numAt(byReq[rid], "actual", 0);
    }
    double deltaNominal = std::max(0.0, nominal - prevNominal);
    double deltaActual = std::max(0.0, actual - prevActual);
    if (rid.empty()) {
      deltaNominal = nominal;
      deltaActual = actual;
    }

    u["credits"] = numAt(u, "credits", 0) + deltaNominal;
    u["charged"] = numAt(u, "charged", 0) + deltaActual;

    json daily = jval(u, "daily", json::object());
    if (!daily.is_object()) daily = json::object();
    std::string day = todayKey();
    daily[day] = numAt(daily, day.c_str(), 0) + deltaNominal;
    u["daily"] = daily;

    if (!rid.empty()) byReq[rid] = {{"nominal", nominal}, {"actual", actual}};
    u["byRequest"] = byReq;
    u["lastTurn"] = {{"nominal", nominal}, {"actual", actual}, {"at", nowMs()}};
  }

  if (data.contains("quota") && data["quota"].is_object()) u["quota"] = data["quota"];
  if (data.contains("tokens") && data["tokens"].is_object()) u["tokens"] = data["tokens"];
  session["usage"] = u;
}

void Backend::appendEvent(const std::string& uiId, const std::string& type, json data) {
  // 这几类只用于当下渲染，落盘会把会话文件撑大且无回放价值
  static const std::set<std::string> transient = {"commands", "config", "mode", "raw_update", "models"};
  std::lock_guard<std::mutex> lk(storeMu_);
  json* s = findSession(uiId);
  if (!s) return;
  if (!transient.count(type)) {
    json& evs = (*s)["events"];
    if (!evs.is_array()) evs = json::array();
    // 流式文本直接并进上一条，避免一个会话存出十万级事件
    if (evs.empty() || !mergeStreamingEvent(evs.back(), type, data)) {
      evs.push_back({{"type", type}, {"data", data}});
      if (evs.size() > kSessionEventCap * 2) compactSessionEvents(evs, kSessionEventCap);
    }
  }
  (*s)["updatedAt"] = nowMs();
  if (type == "usage") mergeUsage(*s, data);
}

void Backend::emit(const std::string& uiId, const std::string& type, json data) {
  appendEvent(uiId, type, data);
  bus_.push(type, uiId, std::move(data));
}

std::string Backend::acpSessionFor(const std::string& uiId, std::string& err) {
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    auto it = uiToAcp_.find(uiId);
    if (it != uiToAcp_.end() && !it->second.empty()) return it->second;
  }
  std::string cwd;
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    json* s = findSession(uiId);
    if (!s) {
      err = "会话不存在";
      return "";
    }
    cwd = jstr(*s, "cwd", currentCwd());
  }
  json info;
  try {
    if (!ensureAgent(err)) return "";
    info = takeSpareSession(cwd);
    if (!info.is_object() || info.empty()) info = client_->newSessionInfo(cwd);
  } catch (const std::exception& e) {
    err = e.what();
    return "";
  }
  std::string acpSid = jstr(info, "sessionId");
  if (acpSid.empty()) {
    err = "创建 ACP 会话失败";
    return "";
  }
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    uiToAcp_[uiId] = acpSid;
    acpToUi_[acpSid] = uiId;
  }
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    if (json* ss = findSession(uiId)) {
      (*ss)["acpSessionId"] = acpSid;
      if (jstr(*ss, "model").empty()) {
        (*ss)["model"] = jstr(jval(info, "models", json::object()), "currentModelId", selectedModel());
      }
    }
  }
  absorbSessionInfo(info, uiId);
  return acpSid;
}

json Backend::saveImages(const json& incoming) {
  json out = json::array();
  if (!incoming.is_array()) return out;
  std::string dir = localAppDir() + "\\images";
  CreateDirectoryA(dir.c_str(), nullptr);

  int saved = 0;
  for (const auto& img : incoming) {
    if (saved >= 4 || !img.is_object()) break;
    std::string mime = jstr(img, "mime", "image/png");
    std::string b64 = jstr(img, "data");
    // 12MB base64 ≈ 9MB 原图，再大就不该走这个壳传了
    if (b64.empty() || b64.size() > 12u * 1024 * 1024) continue;
    std::string bin = base64Decode(b64);
    if (bin.empty()) continue;

    std::string fileName = randomId("img_") + imageExtFor(mime);
    std::ofstream f(dir + "\\" + fileName, std::ios::binary | std::ios::trunc);
    if (!f) continue;
    f.write(bin.data(), static_cast<std::streamsize>(bin.size()));
    if (!f) continue;
    f.close();

    out.push_back({{"url", "/api/images/" + fileName},
                   {"mime", mime},
                   {"name", jstr(img, "name", "图片")}});
    ++saved;
  }
  return out;
}

void Backend::handleCatalog(const httplib::Request&, httplib::Response& res) {
  try {
    res.set_content(dumpJson(buildCatalog(currentCwd())), "application/json; charset=utf-8");
  } catch (const std::exception& e) {
    logf(std::string("buildCatalog 失败: ") + e.what());
    res.set_content(dumpJson(json{{"skills", json::array()},
                                  {"connectors", json::array()},
                                  {"plugins", json::array()},
                                  {"marketplaces", json::array()}}),
                    "application/json; charset=utf-8");
  }
}

void Backend::handleImage(const httplib::Request& req, httplib::Response& res) {
  std::string name = req.matches.size() > 1 ? req.matches[1].str() : "";
  if (name.empty() || name.find("..") != std::string::npos ||
      name.find('/') != std::string::npos || name.find('\\') != std::string::npos) {
    res.status = 400;
    return;
  }
  std::ifstream in(localAppDir() + "\\images\\" + name, std::ios::binary);
  if (!in) {
    res.status = 404;
    return;
  }
  std::stringstream ss;
  ss << in.rdbuf();
  res.set_header("Cache-Control", "max-age=86400");
  res.set_content(ss.str(), contentTypeFor(name));
}

void Backend::runPrompt(const std::string& uiId, const std::string& text, const std::string& mode,
                        const json& images, const std::string& model) {
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.insert(uiId);
  }
  std::string err;
  std::string acpSid = acpSessionFor(uiId, err);
  if (acpSid.empty()) {
    emit(uiId, "error", json{{"message", err}});
    emit(uiId, "done", json{{"stopReason", "error"}});
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
    return;
  }
  try {
    if (!model.empty()) client_->setConfigOption(acpSid, "model", model);
  } catch (const std::exception& e) {
    logf(std::string("set model 失败: ") + e.what());
  }
  try {
    if (!mode.empty()) client_->setConfigOption(acpSid, "mode", mode);
  } catch (const std::exception& e) {
    logf(std::string("setConfigOption 失败: ") + e.what());
  }
  try {
    json result = client_->prompt(acpSid, text, images);
    emit(uiId, "done", json{{"stopReason", jstr(result, "stopReason", "end_turn")}});
  } catch (const std::exception& e) {
    std::string msg = e.what();
    if (isAuthError(msg)) {
      emit(uiId, "auth_required",
           json{{"message",
                 "CodeBuddy 还没登录，无法调用模型。请在终端运行 codebuddy 并执行 /login，"
                 "或用 CODEBUDDY_API_KEY 环境变量提供密钥后重启本应用。"}});
    } else {
      emit(uiId, "error", json{{"message", msg}});
    }
    emit(uiId, "done", json{{"stopReason", "error"}});
  }
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
  }
  saveStore();
}

// ---------- 演示运行时：产出与真实 ACP 同构的事件，方便没有登录态时验证界面 ----------
void Backend::runDemo(const std::string& uiId, const std::string& text) {
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.insert(uiId);
  }
  auto sleepMs = [](int ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); };
  auto alive = [&] {
    std::lock_guard<std::mutex> lk(mapMu_);
    return running_.count(uiId) > 0;
  };

  std::string fileName = "demo-note.md";
  std::string body = "# 演示产物\n\n你刚才说：「" + text +
                     "」\n\n这份文件由内置演示代理生成，用来验证流式输出、工具卡片、权限审批和 diff 渲染。\n";

  sleepMs(150);
  emit(uiId, "thought", json{{"text", "先判断这是个要落盘的请求，"}});
  sleepMs(350);
  emit(uiId, "thought", json{{"text", "路径定了就直接写。"}});
  emit(uiId, "plan",
       json{{"entries", json::array({{{"content", "看清当前目录"}, {"status", "in_progress"}},
                                     {{"content", "把结论写成文件"}, {"status", "pending"}},
                                     {{"content", "读回核验"}, {"status", "pending"}}})}});

  sleepMs(250);
  std::string toolId = randomId("tool_");
  emit(uiId, "tool",
       json{{"id", toolId},
            {"title", "写入 " + fileName},
            {"kind", "edit"},
            {"status", "pending"},
            {"content", json::array()},
            {"rawInput", {{"path", fileName}, {"bytes", (int)body.size()}}}});

  std::string requestId = randomId("perm_");
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    pendingPerm_[requestId] = {0, uiId};  // 演示模式没有 RPC id，占位即可
  }
  emit(uiId, "permission",
       json{{"requestId", requestId},
            {"title", "允许写入 " + fileName + " ？"},
            {"kind", "edit"},
            {"toolCallId", toolId},
            {"options", json::array({{{"optionId", "allow_once"}, {"name", "允许一次"}},
                                     {{"optionId", "allow_always"}, {"name", "本会话都允许"}},
                                     {{"optionId", "reject_once"}, {"name", "拒绝"}}})}});

  // 等前端点按钮（最多 20 秒自动放行）
  std::string optionId;
  for (int i = 0; i < 200; ++i) {
    if (!alive()) break;
    {
      std::lock_guard<std::mutex> lk(mapMu_);
      auto it = permResults_.find(requestId);
      if (it != permResults_.end()) {
        optionId = it->second;
        permResults_.erase(it);
        break;
      }
    }
    sleepMs(100);
  }
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    pendingPerm_.erase(requestId);
  }
  if (optionId.empty()) optionId = alive() ? "allow_once" : "cancelled";
  emit(uiId, "permission_resolved", json{{"requestId", requestId}, {"optionId", optionId}});
  if (optionId == "cancelled") {
    emit(uiId, "tool_update", json{{"id", toolId}, {"status", "cancelled"}});
    emit(uiId, "done", json{{"stopReason", "cancelled"}});
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
    return;
  }

  if (optionId.rfind("reject", 0) == 0) {
    emit(uiId, "tool_update", json{{"id", toolId}, {"status", "failed"}});
    emit(uiId, "text", json{{"text", "好的，这次不写文件。"}});
    emit(uiId, "done", json{{"stopReason", "end_turn"}});
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
    return;
  }

  emit(uiId, "tool_update", json{{"id", toolId}, {"status", "in_progress"}});
  sleepMs(600);
  emit(uiId, "tool_update",
       json{{"id", toolId},
            {"status", "completed"},
            {"content", json::array({{{"type", "diff"},
                                      {"path", fileName},
                                      {"oldText", ""},
                                      {"newText", body}},
                                     {{"type", "text"}, {"text", "已写入 " + std::to_string(body.size()) + " 字节"}}})}});

  std::string answer =
      "已经处理完了。\n\n**做了什么**\n1. 解析请求：「" + utf8Truncate(text, 60) + "」\n2. 写入 `" +
      fileName + "`\n3. 读回校验，内容一致\n\n> 这条回答来自演示代理，用于验证流式渲染与工具卡片，"
      "不含真实模型推理。\n\n要接真实模型：终端里运行 `codebuddy` 完成 `/login`，再重启本应用。";
  // 严格按 UTF-8 字符推进，切半个汉字会让 json 序列化直接抛异常
  for (size_t i = 0; i < answer.size();) {
    unsigned char c = static_cast<unsigned char>(answer[i]);
    size_t len = 1;
    if ((c & 0xE0) == 0xC0) len = 2;
    else if ((c & 0xF0) == 0xE0) len = 3;
    else if ((c & 0xF8) == 0xF0) len = 4;
    if (i + len > answer.size()) len = answer.size() - i;
    emit(uiId, "text", json{{"text", answer.substr(i, len)}});
    i += len;
    sleepMs(18);
  }
  emit(uiId, "usage",
       json{{"used", 15800},
            {"size", 1000000},
            {"credit", 0.0},
            {"originalCredit", 4.37},
            {"requestId", randomId("req_")},
            {"quota",
             {{"model", "hy4"}, {"percent", 12.5}, {"resetAt", nowMs() + 86400000}, {"sharedModels", json::array()}}},
            {"tokens", {{"inputTokens", 15800}, {"outputTokens", 420}, {"totalTokens", 16220}}}});
  emit(uiId, "done", json{{"stopReason", "end_turn"}});
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
  }
  saveStore();
}

// ---------------------------- 路由 ----------------------------

void Backend::handleBootstrap(const httplib::Request&, httplib::Response& res) {
  const std::string cw = currentCwd();
  const std::string today = todayKey();
  json sessions = json::array();
  std::string lastId;
  std::string storedLast;
  bool storedIsCurrent = false;
  double credits = 0, charged = 0, todayCredits = 0;
  json quota = json::object();
  int64_t quotaAt = 0;
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    storedLast = jstr(store_, "lastSessionId");
    const auto& all = jval(store_, "sessions", json::array());
    for (auto it = all.rbegin(); it != all.rend(); ++it) {
      const json& s = *it;
      std::string id = jstr(s, "id");
      bool here = samePath(jstr(s, "cwd"), cw);
      if (here) {
        if (lastId.empty() && !fresh_) lastId = id;
        if (id == storedLast) storedIsCurrent = true;
      }
      json u = jval(s, "usage", json::object());
      if (here) {
        credits += numAt(u, "credits", 0);
        charged += numAt(u, "charged", 0);
        json daily = jval(u, "daily", json::object());
        if (daily.is_object()) todayCredits += numAt(daily, today.c_str(), 0);
      }
      json q = jval(u, "quota", json::object());
      if (q.is_object() && !q.empty()) {
        int64_t at = static_cast<int64_t>(numAt(jval(u, "lastTurn", json::object()), "at", 0));
        if (at == 0) at = s.value("updatedAt", static_cast<int64_t>(0));
        if (at >= quotaAt) {
          quotaAt = at;
          quota = q;
        }
      }
      // 别用 jval 取 events：它是按值返回，会把整份事件数组深拷贝一遍
      auto evIt = s.find("events");
      int64_t msgCount =
          (evIt != s.end() && evIt->is_array()) ? static_cast<int64_t>(evIt->size()) : 0;
      sessions.push_back({{"id", id},
                          {"title", jstr(s, "title", "新会话")},
                          {"cwd", jstr(s, "cwd")},
                          {"model", jstr(s, "model")},
                          {"mode", jstr(s, "mode", "fullAccess")},
                          {"updatedAt", s.value("updatedAt", static_cast<int64_t>(0))},
                          {"usage",
                           {{"used", jval(u, "used", json(0))},
                            {"size", jval(u, "size", json(0))},
                            {"credits", numAt(u, "credits", 0)},
                            {"charged", numAt(u, "charged", 0)}}},
                          {"messageCount", msgCount}});
      if (sessions.size() >= 500) break;
    }
    if (fresh_) lastId.clear();
    if (storedIsCurrent && !fresh_) lastId = storedLast;
  }
  std::string model = selectedModel();
  if (model.empty()) model = "deepseek-v4.1-flash";
  json projectNames = json::object();
  {
    json doc = readJsonFile(localAppDir() + "\\projects.json");
    json projects = jval(doc, "projects", json::object());
    if (projects.is_object()) {
      for (auto it = projects.begin(); it != projects.end(); ++it) {
        std::string name = jstr(it.value(), "name");
        if (!name.empty()) projectNames[it.key()] = name;
      }
    }
  }
  json ws = activeWorkspaceInfo();
  auto wsFolders = foldersOf(ws);
  json out = {{"demo", demo_},
              {"cwd", cw},
              {"workspace", jstr(ws, "name", leafName(cw))},
              {"workspaceId", jstr(ws, "id")},
              {"workspaceName", jstr(ws, "name", leafName(cw))},
              {"workspaceFolders", wsFolders},
              {"fresh", fresh_},
              {"port", port_},
              {"agentReady", agentReady_.load()},
              {"agentError", agentError_},
              {"status", statusText()},
              {"model", model},
              {"credits", credits},
              {"charged", charged},
              {"todayCredits", todayCredits},
              {"quota", quota},
              {"sessions", sessions},
              {"projectNames", projectNames},
              {"lastSessionId", lastId},
              {"lastSeq", bus_.lastSeq()}};
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleSessions(const httplib::Request& req, httplib::Response& res) {
  if (req.method == "POST") {
    json body = json::parse(req.body, nullptr, false);
    std::string cwd = jstr(body, "cwd", currentCwd());
    json s = createSession(cwd, "");
    res.set_content(dumpJson(json{{"session", s}}), "application/json; charset=utf-8");
    return;
  }
  handleBootstrap(req, res);
}

void Backend::handleSessionDetail(const httplib::Request& req, httplib::Response& res) {
  std::string id = req.matches.size() > 1 ? req.matches[1].str() : "";
  json out;
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    json* s = findSession(id);
    if (!s) {
      res.status = 404;
      res.set_content(dumpJson(json{{"error", "会话不存在"}}), "application/json");
      return;
    }
    // 元数据按字段拷，事件单独截断：历史会话可能有几万条，全量下发会卡住前端
    out = json::object();
    for (auto it = s->begin(); it != s->end(); ++it) {
      if (it.key() == "events") continue;
      out[it.key()] = it.value();
    }
    auto evIt = s->find("events");
    if (evIt != s->end() && evIt->is_array()) {
      const json& evs = *evIt;
      size_t total = evs.size();
      size_t start = total > kSessionEventCap ? total - kSessionEventCap : 0;
      json tail = json::array();
      for (size_t i = start; i < total; ++i) tail.push_back(evs[i]);
      out["events"] = tail;
      if (start > 0) out["truncated"] = static_cast<int64_t>(start);
    } else {
      out["events"] = json::array();
    }
  }
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleDeleteSession(const httplib::Request& req, httplib::Response& res) {
  std::string id = req.matches.size() > 1 ? req.matches[1].str() : "";
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    auto& arr = store_["sessions"];
    json keep = json::array();
    for (auto& s : arr) {
      if (jstr(s, "id") != id) keep.push_back(s);
    }
    arr = keep;
    deletedIds_.insert(id);
  }
  saveStore();
  res.set_content(dumpJson(json{{"ok", true}}), "application/json");
}

void Backend::handleRename(const httplib::Request& req, httplib::Response& res) {
  std::string id = req.matches.size() > 1 ? req.matches[1].str() : "";
  json body = json::parse(req.body, nullptr, false);
  std::string title = jstr(body, "title");
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    if (json* s = findSession(id)) (*s)["title"] = title;
  }
  saveStore();
  res.set_content(dumpJson(json{{"ok", true}}), "application/json");
}

void Backend::handleChat(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (!body.is_object()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "请求体不是 JSON 对象"}}), "application/json");
    return;
  }
  std::string text = jstr(body, "text");
  json incomingImages = jval(body, "images", json::array());
  json connectors = jval(body, "connectors", json::array());
  if (text.empty() && (!incomingImages.is_array() || incomingImages.empty())) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少 text 或 images"}}), "application/json");
    return;
  }
  std::string mode = jstr(body, "mode");
  std::string model = jstr(body, "model", selectedModel());
  std::string uiId = jstr(body, "sessionId");

  json images = saveImages(incomingImages);
  if (text.empty() && images.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "图片解码失败"}}), "application/json");
    return;
  }

  bool needCreate = false;
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    json* s = uiId.empty() ? nullptr : findSession(uiId);
    if (!s) {
      needCreate = true;
    } else {
      if ((*s)["events"].empty()) {
        (*s)["title"] = text.empty() ? "图片对话" : truncateTitle(text);
      }
      if (!mode.empty()) (*s)["mode"] = mode;
      if (!model.empty()) (*s)["model"] = model;
    }
  }
  if (needCreate) {
    uiId = createSession(currentCwd(), text.empty() ? "图片对话" : truncateTitle(text))["id"].get<std::string>();
    std::lock_guard<std::mutex> lk(storeMu_);
    if (json* s = findSession(uiId)) {
      if (!model.empty()) (*s)["model"] = model;
      if (!mode.empty()) (*s)["mode"] = mode;
    }
  }

  // 用户气泡按原文渲染，连接器引用单独挂字段，不改写用户输入
  json userEvent = {{"text", text}};
  if (connectors.is_array() && !connectors.empty()) userEvent["connectors"] = connectors;
  if (!images.empty()) userEvent["images"] = images;
  emit(uiId, "user", userEvent);

  // 连接器是会话级 MCP 配置，这里指定只影响本轮的提示，改不了服务端注册
  std::string promptText = text;
  json promptImages = json::array();
  for (const auto& img : incomingImages) {
    if (!img.is_object()) continue;
    std::string data = jstr(img, "data");
    if (data.empty()) continue;
    promptImages.push_back({{"mime", jstr(img, "mime", "image/png")}, {"data", data}});
    if (promptImages.size() >= images.size()) break;
  }
  if (connectors.is_array() && !connectors.empty()) {
    std::string names;
    for (const auto& c : connectors) {
      if (!c.is_string()) continue;
      if (!names.empty()) names += "、";
      names += c.get<std::string>();
    }
    if (!names.empty()) {
      promptText = "请优先使用以下连接器（MCP 服务）完成这个请求：" + names + "\n\n" + text;
    }
  }

  // 多文件夹工作空间：cwd 只是第一个文件夹，其余要把绝对路径告诉模型
  {
    json ws = activeWorkspaceInfo();
    auto folders = foldersOf(ws);
    if (folders.size() > 1) {
      std::string note = "当前工作空间「" + jstr(ws, "name", leafName(folders[0])) +
                         "」包含以下文件夹（工作目录是第一个，其余需要时用绝对路径访问）：\n";
      for (size_t i = 0; i < folders.size(); ++i)
        note += std::to_string(i + 1) + ". " + folders[i] + "\n";
      note += "\n";
      promptText = note + promptText;
    }
  }

  std::thread([this, uiId, promptText, mode, model, promptImages] {
    if (demo_) runDemo(uiId, promptText);
    else runPrompt(uiId, promptText, mode, promptImages, model);
  }).detach();

  res.set_content(dumpJson(json{{"sessionId", uiId}, {"images", images}}),
                  "application/json; charset=utf-8");
}

void Backend::handlePermission(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string requestId = jstr(body, "requestId");
  std::string optionId = jstr(body, "optionId");
  bool ok = false;
  int64_t rpcId = 0;
  std::string uiId;
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    auto it = pendingPerm_.find(requestId);
    if (it != pendingPerm_.end()) {
      rpcId = it->second.first;
      uiId = it->second.second;
      pendingPerm_.erase(it);
      ok = true;
      if (demo_) permResults_[requestId] = optionId;  // 演示线程轮询取结果
    }
  }
  if (ok && !demo_ && client_) {
    client_->reply(rpcId, json{{"outcome", {{"outcome", "selected"}, {"optionId", optionId}}}});
    emit(uiId, "permission_resolved", json{{"requestId", requestId}, {"optionId", optionId}});
  }
  res.set_content(dumpJson(json{{"ok", ok}}), "application/json");
}

void Backend::handleCancel(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string uiId = jstr(body, "sessionId");
  {
    std::lock_guard<std::mutex> lk(mapMu_);
    running_.erase(uiId);
    auto it = uiToAcp_.find(uiId);
    if (it != uiToAcp_.end() && client_) client_->cancel(it->second);
  }
  res.set_content(dumpJson(json{{"ok", true}}), "application/json");
}

// 长轮询：有事件立刻返回，没有就最多挂 wait 毫秒再返回空数组。
// 用长轮询而不是 SSE，是为了让客户端完全掌握 from 游标，重连不会重放或丢事件。
void Backend::handleStream(const httplib::Request& req, httplib::Response& res) {
  uint64_t from = 0;
  int waitMs = 10000;
  try {
    if (req.has_param("from")) from = std::stoull(req.get_param_value("from"));
    if (req.has_param("wait")) waitMs = std::stoi(req.get_param_value("wait"));
  } catch (...) {
  }
  auto events = bus_.takeAfter(from, 200, waitMs);
  // 流式输出时事件来得又碎又密，短暂再等一小会儿把同一批合并掉，减少往返
  if (events.size() < 8 && waitMs > 0) {
    uint64_t tail = events.empty() ? from : events.back().seq;
    auto more = bus_.takeAfter(tail, 200, 120);
    events.insert(events.end(), more.begin(), more.end());
  }
  json arr = json::array();
  for (const auto& e : events) {
    // 事件级 sessionId 是权威来源，前端按它过滤；载荷里的字段可能被上游改写
    arr.push_back({{"seq", e.seq}, {"type", e.type}, {"sessionId", e.sessionId}, {"data", e.data}});
  }
  json out = {{"events", arr}, {"lastSeq", bus_.lastSeq()}};
  res.set_header("Cache-Control", "no-store");
  try {
    res.set_content(dumpJson(out), "application/json; charset=utf-8");
  } catch (const std::exception& e) {
    logf(std::string("handleStream 序列化失败: ") + e.what());
    res.status = 200;
    res.set_content("{\"events\":[],\"lastSeq\":0}", "application/json; charset=utf-8");
  }
}

void Backend::handleModels(const httplib::Request&, httplib::Response& res) {
  std::string err;
  ensureModelCatalog(err);
  json out;
  {
    std::lock_guard<std::mutex> lk(modelMu_);
    out = modelCatalog_;
    out["selected"] = selectedModel_.empty() ? jstr(modelCatalog_, "currentId") : selectedModel_;
  }
  out["quota"] = latestQuota();
  out["demo"] = demo_;
  out["agentReady"] = agentReady_.load();
  if (!err.empty()) out["error"] = err;
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleSetModel(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string model = jstr(body, "model");
  std::string uiId = jstr(body, "sessionId");
  if (model.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少 model"}}), "application/json");
    return;
  }
  {
    std::lock_guard<std::mutex> lk(modelMu_);
    selectedModel_ = model;
    if (modelCatalog_.is_object()) modelCatalog_["currentId"] = model;
  }
  bool applied = false;
  std::string error;
  std::string acpSid;
  if (!uiId.empty()) {
    std::lock_guard<std::mutex> lk(mapMu_);
    auto it = uiToAcp_.find(uiId);
    if (it != uiToAcp_.end()) acpSid = it->second;
  }
  if (!acpSid.empty() && client_) {
    try {
      client_->setConfigOption(acpSid, "model", model);
      applied = true;
    } catch (const std::exception& e) {
      error = e.what();
      logf(std::string("handleSetModel 失败: ") + error);
    }
  }
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    if (json* s = findSession(uiId)) (*s)["model"] = model;
  }
  res.set_content(dumpJson(json{{"ok", error.empty()}, {"applied", applied}, {"model", model}, {"error", error}}),
                  "application/json; charset=utf-8");
}

void Backend::handleUsage(const httplib::Request&, httplib::Response& res) {
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(usageSummary()), "application/json; charset=utf-8");
}

void Backend::handleWorkspaces(const httplib::Request&, httplib::Response& res) {
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(workspaceList()), "application/json; charset=utf-8");
}

void Backend::handleWorkspaceOpen(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string path = jstr(body, "path");
  if (!isDirectoryPath(path)) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "目录不存在"}}), "application/json");
    return;
  }
  if (!spawnWindow(path)) {
    res.status = 500;
    res.set_content(dumpJson(json{{"error", "打开新窗口失败"}}), "application/json");
    return;
  }
  res.set_content(dumpJson(json{{"ok", true}, {"path", path}}), "application/json");
}

void Backend::handleWorkspaceUse(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string id = jstr(body, "id");
  std::string path = jstr(body, "path");

  json ws;
  if (!id.empty()) {
    ws = findWorkspace(id);
    if (ws.empty()) {
      res.status = 404;
      res.set_content(dumpJson(json{{"ok", false}, {"error", "工作空间不存在"}}),
                      "application/json; charset=utf-8");
      return;
    }
  } else {
    if (!isDirectoryPath(path)) {
      res.status = 400;
      res.set_content(dumpJson(json{{"ok", false}, {"error", "目录不存在"}}),
                      "application/json; charset=utf-8");
      return;
    }
    ws = workspaceByFolder(path);
    if (ws.empty()) {
      ws = {{"id", ""}, {"name", leafName(path)}, {"folders", json::array({path})}};
    }
  }

  activateWorkspace(ws, true, path);
  auto folders = foldersOf(ws);
  res.set_content(dumpJson(json{{"ok", true},
                                {"cwd", currentCwd()},
                                {"workspace", jstr(ws, "name", leafName(currentCwd()))},
                                {"id", jstr(ws, "id")},
                                {"folders", folders}}),
                  "application/json; charset=utf-8");
}

void Backend::handleWorkspacePick(const httplib::Request&, httplib::Response& res) {
  std::string path = pickFolder();
  res.set_content(dumpJson(json{{"path", path}}), "application/json; charset=utf-8");
}

void Backend::handleWorkspaceCreate(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string name = jstr(body, "name");
  size_t b = name.find_first_not_of(" \t\r\n");
  size_t e = name.find_last_not_of(" \t\r\n");
  name = (b == std::string::npos) ? "" : name.substr(b, e - b + 1);
  auto bad = [&](const std::string& msg) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", msg}}), "application/json; charset=utf-8");
  };
  if (name.empty()) return bad("请填写工作空间名称");
  if (name.find_first_of("\\/:*?\"<>|") != std::string::npos || name == "." || name == "..")
    return bad("名称不能包含 \\ / : * ? \" < > |");

  std::string parent = jstr(body, "parent");
  if (parent.empty()) {
    std::string home = homePath();
    if (home.empty()) return bad("无法确定默认位置，请指定父目录");
    parent = joinPathSafe(home, "WorkBuddy");
  }

  std::error_code ec;
  if (!isDirectoryPath(parent)) {
    std::filesystem::create_directories(std::filesystem::path(utf8ToWide(parent)), ec);
    if (!isDirectoryPath(parent)) return bad("父目录不可用：" + parent);
  }

  std::string path = joinPathSafe(parent, name);
  // 统一成反斜杠 + 去掉 .. 之类，界面显示和后续路径比较都省事
  {
    std::string canon = canonicalPath(path);
    if (!canon.empty()) path = canon;
  }
  bool existed = isDirectoryPath(path);
  if (!existed) {
    std::filesystem::create_directories(std::filesystem::path(utf8ToWide(path)), ec);
    if (!isDirectoryPath(path)) {
      res.status = 500;
      res.set_content(dumpJson(json{{"ok", false}, {"error", "创建目录失败：" + ec.message()}}),
                      "application/json; charset=utf-8");
      return;
    }
  }

  // 建（或复用）一个单文件夹工作空间，并切过去
  json ws = workspaceByFolder(path);
  if (ws.empty()) {
    ws = {{"id", randomId("ws_")},
          {"name", name},
          {"folders", json::array({path})},
          {"createdAt", nowMs()},
          {"updatedAt", nowMs()}};
    json doc = loadWorkspacesDoc();
    json arr = jval(doc, "workspaces", json::array());
    arr.push_back(ws);
    doc["workspaces"] = arr;
    saveWorkspacesDoc(doc);
  } else {
    existed = true;
  }

  // 侧栏按 cwd 分组，名字也从这里取
  {
    json doc = readJsonFile(projectsFilePath());
    json projects = jval(doc, "projects", json::object());
    if (!projects.is_object()) projects = json::object();
    projects[pathKey(path)] = {{"path", path}, {"name", name}, {"updatedAt", nowMs()}};
    doc["projects"] = projects;
    saveProjectsDoc(doc);
  }
  activateWorkspace(ws, true, path);
  logf("新建工作空间 " + path + (existed ? "（已存在）" : ""));
  res.set_content(dumpJson(json{{"ok", true},
                                {"path", path},
                                {"workspace", jstr(ws, "name", name)},
                                {"id", jstr(ws, "id")},
                                {"folders", foldersOf(ws)},
                                {"existed", existed}}),
                  "application/json; charset=utf-8");
}

// 新建或编辑：{id?, name, folders[]}
void Backend::handleWorkspaceSave(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  auto fail = [&](int code, const std::string& msg) {
    res.status = code;
    res.set_content(dumpJson(json{{"ok", false}, {"error", msg}}), "application/json; charset=utf-8");
  };

  std::string name = trimStr(jstr(body, "name"));
  if (name.empty()) return fail(400, "工作空间名称不能为空");
  if (name.size() > 180) return fail(400, "名称太长（最多 180 字节）");

  std::vector<std::string> folders;
  for (const auto& f : jval(body, "folders", json::array())) {
    if (!f.is_string()) continue;
    std::string p = f.get<std::string>();
    std::string canon = canonicalPath(p);
    if (!canon.empty()) p = canon;
    if (!isDirectoryPath(p)) return fail(400, "文件夹不存在：" + p);
    bool dup = false;
    for (const auto& x : folders) {
      if (pathKey(x) == pathKey(p)) {
        dup = true;
        break;
      }
    }
    if (!dup) folders.push_back(p);
  }
  if (folders.empty()) return fail(400, "至少选择一个文件夹");
  if (folders.size() > kMaxWorkspaceFolders) return fail(400, "一个工作空间最多 5 个文件夹");

  std::string id = jstr(body, "id");
  json doc = loadWorkspacesDoc();
  json arr = jval(doc, "workspaces", json::array());

  json saved;
  for (auto& w : arr) {
    if (!w.is_object()) continue;
    if (!id.empty() && jstr(w, "id") == id) {
      w["name"] = name;
      w["folders"] = folders;
      w["updatedAt"] = nowMs();
      saved = w;
      break;
    }
  }
  if (saved.empty()) {
    // 同一个主文件夹只归属一个工作空间，避免列表里出现两条一样的
    for (const auto& w : arr) {
      auto wf = foldersOf(w);
      if (!wf.empty() && pathKey(wf[0]) == pathKey(folders[0]))
        return fail(400, "这个文件夹已经属于工作空间「" + jstr(w, "name", "") + "」");
    }
    saved = {{"id", randomId("ws_")},
             {"name", name},
             {"folders", folders},
             {"createdAt", nowMs()},
             {"updatedAt", nowMs()}};
    arr.push_back(saved);
  }
  doc["workspaces"] = arr;
  if (!saveWorkspacesDoc(doc)) return fail(500, "保存工作空间失败");

  // 主文件夹的名字同步给侧栏分组
  {
    json pdoc = readJsonFile(projectsFilePath());
    json projects = jval(pdoc, "projects", json::object());
    if (!projects.is_object()) projects = json::object();
    projects[pathKey(folders[0])] = {{"path", folders[0]}, {"name", name}, {"updatedAt", nowMs()}};
    pdoc["projects"] = projects;
    saveProjectsDoc(pdoc);
  }

  // 改的正好是当前工作空间 → 立刻生效（cwd 还在列表里就保持不变）
  if (jstr(activeWorkspaceInfo(), "id") == jstr(saved, "id")) {
    activateWorkspace(saved, true, currentCwd());
  }

  if (!demo_) {
    std::lock_guard<std::mutex> lk(wsCacheMu_);
    wsCacheAt_ = 0;  // 让工作空间对话框下次重新读
  }
  res.set_content(dumpJson(json{{"ok", true}, {"workspace", saved}}),
                  "application/json; charset=utf-8");
}

void Backend::handleWorkspaceRemove(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string id = jstr(body, "id");
  if (id.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "缺少 id"}}), "application/json");
    return;
  }
  json doc = loadWorkspacesDoc();
  json arr = json::array();
  bool removed = false;
  for (const auto& w : jval(doc, "workspaces", json::array())) {
    if (jstr(w, "id") == id) {
      removed = true;
      continue;
    }
    arr.push_back(w);
  }
  if (!removed) {
    res.status = 404;
    res.set_content(dumpJson(json{{"ok", false}, {"error", "工作空间不存在"}}), "application/json");
    return;
  }
  doc["workspaces"] = arr;
  saveWorkspacesDoc(doc);

  bool wasActive = false;
  {
    std::lock_guard<std::mutex> lk(wsMu_);
    if (jstr(activeWorkspace_, "id") == id) {
      activeWorkspace_ = json::object();
      wasActive = true;
    }
  }
  if (wasActive) {
    // 只删掉分组，不删文件夹；当前 cwd 保持原样
    saveSetting("lastWorkspaceId", "");
  }
  res.set_content(dumpJson(json{{"ok", true}}), "application/json; charset=utf-8");
}

json Backend::renameWorkspaceByFolder(const std::string& path, const std::string& name) {
  if (path.empty() || name.empty()) return json::object();
  std::string key = pathKey(path);
  json doc = loadWorkspacesDoc();
  json arr = jval(doc, "workspaces", json::array());
  json updated;
  for (auto& w : arr) {
    if (!w.is_object()) continue;
    auto folders = foldersOf(w);
    if (folders.empty() || pathKey(folders[0]) != key) continue;
    w["name"] = name;
    w["updatedAt"] = nowMs();
    updated = w;
    break;
  }
  if (updated.empty()) return updated;
  doc["workspaces"] = arr;
  saveWorkspacesDoc(doc);
  if (jstr(activeWorkspaceInfo(), "id") == jstr(updated, "id")) {
    std::lock_guard<std::mutex> lk(wsMu_);
    activeWorkspace_ = updated;
  }
  return updated;
}

void Backend::handleFile(const httplib::Request& req, httplib::Response& res) {
  std::string raw = req.get_param_value("path");
  if (raw.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少 path"}}), "application/json");
    return;
  }
  // 兼容 file:///C:/... 这种 URI
  if (raw.rfind("file://", 0) == 0) {
    raw = raw.substr(7);
    if (!raw.empty() && raw[0] == '/') raw.erase(0, 1);
  }
  const std::string cwd = currentCwd();
  std::filesystem::path candidate(utf8ToWide(raw));
  if (candidate.is_relative()) candidate = std::filesystem::path(utf8ToWide(cwd)) / candidate;
  std::string full = wideToUtf8(candidate.wstring());

  bool inside = false;
  for (const auto& folder : foldersOf(activeWorkspaceInfo())) {
    if (isPathInside(folder, full)) {
      inside = true;
      break;
    }
  }
  if (!inside) {
    res.status = 403;
    res.set_content(dumpJson(json{{"error", "只能读取当前工作空间内的文件"}}), "application/json");
    return;
  }
  if (!isFilePath(full)) {
    res.status = 404;
    res.set_content(dumpJson(json{{"error", "文件不存在"}}), "application/json");
    return;
  }
  res.set_header("Cache-Control", "no-store");
  res.set_header("Accept-Ranges", "bytes");
  res.set_header("Content-Disposition", "inline");
  res.set_file_content(full, contentTypeFor(full));
}

void Backend::handleIuiGet(const httplib::Request&, httplib::Response& res) {
  json doc = readJsonFile(localAppDir() + "\\intelligent-ui.json");
  json out = {{"templates", jval(doc, "templates", json::array())},
              {"saved", jval(doc, "saved", json::array())},
              {"defaultTemplateId", jstr(doc, "defaultTemplateId")}};
  res.set_header("Cache-Control", "no-store");
  res.set_content(dumpJson(out), "application/json; charset=utf-8");
}

void Backend::handleIuiSet(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  if (!body.is_object()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "请求体不是 JSON 对象"}}), "application/json");
    return;
  }
  json doc = {{"templates", jval(body, "templates", json::array())},
              {"saved", jval(body, "saved", json::array())},
              {"defaultTemplateId", jstr(body, "defaultTemplateId")}};
  std::string path = localAppDir() + "\\intelligent-ui.json";
  std::string tmp = path + ".tmp";

  HANDLE mtx = CreateMutexA(nullptr, FALSE, "Local\\WorkBuddyLiteIui");
  if (mtx) WaitForSingleObject(mtx, 5000);
  std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
  bool ok = false;
  if (out) {
    out << dumpJson(doc);
    out.close();
    ok = MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING) != 0;
  }
  if (mtx) {
    ReleaseMutex(mtx);
    CloseHandle(mtx);
  }
  res.set_content(dumpJson(json{{"ok", ok}}), "application/json; charset=utf-8");
}

void Backend::handleProjectRename(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  std::string path = jstr(body, "path");
  std::string name = jstr(body, "name");
  if (path.empty() || name.empty()) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "缺少 path 或 name"}}), "application/json");
    return;
  }
  json doc = readJsonFile(projectsFilePath());
  json projects = jval(doc, "projects", json::object());
  if (!projects.is_object()) projects = json::object();
  projects[pathKey(path)] = {{"path", path}, {"name", name}, {"updatedAt", nowMs()}};
  doc["projects"] = projects;
  saveProjectsDoc(doc);
  renameWorkspaceByFolder(path, name);
  res.set_content(dumpJson(json{{"ok", true}}), "application/json");
}

void Backend::handleProjectApply(const httplib::Request& req, httplib::Response& res) {
  json body = json::parse(req.body, nullptr, false);
  json incomingProjects = jval(body, "projects", json::array());
  json incomingSessions = jval(body, "sessions", json::array());

  int projectCount = 0;
  int sessionCount = 0;
  if (incomingProjects.is_array() && !incomingProjects.empty()) {
    json doc = readJsonFile(projectsFilePath());
    json projects = jval(doc, "projects", json::object());
    if (!projects.is_object()) projects = json::object();
    for (const auto& p : incomingProjects) {
      std::string path = jstr(p, "path", jstr(p, "cwd"));
      std::string name = jstr(p, "name");
      if (path.empty() || name.empty()) continue;
      projects[pathKey(path)] = {{"path", path}, {"name", name}, {"updatedAt", nowMs()}};
      ++projectCount;
    }
    doc["projects"] = projects;
    saveProjectsDoc(doc);
    for (const auto& p : incomingProjects) {
      std::string path = jstr(p, "path", jstr(p, "cwd"));
      std::string name = jstr(p, "name");
      if (!path.empty() && !name.empty()) renameWorkspaceByFolder(path, name);
    }
  }

  if (incomingSessions.is_array() && !incomingSessions.empty()) {
    {
      std::lock_guard<std::mutex> lk(storeMu_);
      for (const auto& item : incomingSessions) {
        std::string id = jstr(item, "id");
        std::string title = jstr(item, "title");
        if (id.empty() || title.empty()) continue;
        if (json* s = findSession(id)) {
          (*s)["title"] = utf8Truncate(title, 160);
          (*s)["updatedAt"] = nowMs();
          ++sessionCount;
        }
      }
    }
    saveStore();
  }
  res.set_content(dumpJson(json{{"ok", true}, {"projects", projectCount}, {"sessions", sessionCount}}),
                  "application/json");
}

void Backend::handleAiOrganize(const httplib::Request&, httplib::Response& res) {
  if (demo_) {
    res.status = 400;
    res.set_content(dumpJson(json{{"error", "演示模式没有模型，不能做 AI 整理"}}), "application/json");
    return;
  }

  json items = json::array();
  {
    std::lock_guard<std::mutex> lk(storeMu_);
    const auto& all = jval(store_, "sessions", json::array());
    int count = 0;
    for (auto it = all.rbegin(); it != all.rend() && count < 80; ++it) {
      const json& s = *it;
      std::string id = jstr(s, "id");
      std::string cwd = jstr(s, "cwd");
      if (id.empty() || cwd.empty()) continue;
      std::string firstUser, lastUser;
      auto evIt = s.find("events");
      int64_t eventCount = 0;
      if (evIt != s.end() && evIt->is_array()) {
        eventCount = static_cast<int64_t>(evIt->size());
        for (const auto& ev : *evIt) {
          if (jstr(ev, "type") != "user") continue;
          std::string text = jstr(jval(ev, "data", json::object()), "text");
          if (text.empty()) continue;
          if (firstUser.empty()) firstUser = text;
          lastUser = text;
        }
      }
      items.push_back({{"id", id},
                       {"title", jstr(s, "title", "新会话")},
                       {"cwd", cwd},
                       {"count", eventCount},
                       {"firstUser", utf8Truncate(firstUser, 120)},
                       {"lastUser", utf8Truncate(lastUser, 120)}});
      ++count;
    }
  }
  if (items.empty()) {
    res.set_content(dumpJson(json{{"ok", false}, {"error", "还没有会话可整理"}}), "application/json");
    return;
  }

  json doc = readJsonFile(projectsFilePath());
  json projects = jval(doc, "projects", json::object());
  if (!projects.is_object()) projects = json::object();
  json names = json::object();
  for (auto it = projects.begin(); it != projects.end(); ++it) {
    std::string name = jstr(it.value(), "name");
    if (!name.empty()) names[it.key()] = name;
  }

  std::string prompt =
      "你是 WorkBuddy 的会话整理助手。请根据会话内容，给项目起更清晰的名字，并给会话起具体标题。\n"
      "只输出一个 JSON 对象，不要输出 Markdown、不要解释、不要调用任何工具。\n"
      "输出格式：{\"projects\":[{\"cwd\":\"...\",\"name\":\"2-8字项目名\"}],"
      "\"sessions\":[{\"id\":\"s_...\",\"title\":\"不超过18字的会话标题\"}]}\n"
      "规则：项目名要体现项目主题，不要用日期或路径；会话标题要具体，能一眼看出做了什么；"
      "不要用“新会话”“你好”这类空标题；只处理给出的会话，不要编造 id；已经很好的标题可以不返回。\n";
  prompt += "已有项目名：" + dumpJson(names) + "\n";
  prompt += "会话列表：" + dumpJson(items);

  std::string err;
  std::string text = runOrganizerPrompt(prompt, err);
  if (!err.empty()) {
    res.status = 500;
    res.set_content(dumpJson(json{{"ok", false}, {"error", err}}), "application/json");
    return;
  }
  json parsed = extractJsonObject(text);
  if (parsed.empty()) {
    res.set_content(dumpJson(json{{"ok", false},
                                 {"error", "模型没有返回可解析的 JSON"},
                                 {"raw", utf8Truncate(text, 800)}}),
                    "application/json");
    return;
  }

  json outProjects = json::array();
  for (const auto& p : jval(parsed, "projects", json::array())) {
    std::string cwd = jstr(p, "cwd");
    std::string name = jstr(p, "name");
    if (cwd.empty() || name.empty()) continue;
    outProjects.push_back({{"cwd", cwd}, {"name", utf8Truncate(name, 60)}});
    if (outProjects.size() >= 100) break;
  }
  json outSessions = json::array();
  for (const auto& s : jval(parsed, "sessions", json::array())) {
    std::string id = jstr(s, "id");
    std::string title = jstr(s, "title");
    if (id.empty() || title.empty()) continue;
    outSessions.push_back({{"id", id}, {"title", utf8Truncate(title, 60)}});
    if (outSessions.size() >= 300) break;
  }
  res.set_content(dumpJson(json{{"ok", true}, {"projects", outProjects}, {"sessions", outSessions}}),
                  "application/json");
}

void Backend::handleStatic(const httplib::Request& req, httplib::Response& res) {
  std::string path = req.path;
  if (path == "/" || path.empty()) path = "/index.html";
  if (path.find("..") != std::string::npos) {
    res.status = 400;
    return;
  }
  std::string full = webRoot_ + path;
  for (auto& c : full)
    if (c == '/') c = '\\';
  std::ifstream in(full, std::ios::binary);
  if (!in) {
    res.status = 404;
    res.set_content("找不到 " + path + "，请确认 web 目录与 exe 同级。", "text/plain; charset=utf-8");
    return;
  }
  std::stringstream ss;
  ss << in.rdbuf();
  // /assets/ 下是带 hash 的构建产物，可以长期缓存；其余保持 no-store，改完立刻能看到
  if (path.rfind("/assets/", 0) == 0) {
    res.set_header("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.set_header("Cache-Control", "no-store");
  }
  res.set_content(ss.str(), contentTypeFor(path));
}

void Backend::setupRoutes() {
  srv_.Get("/api/bootstrap", [this](const auto& r, auto& s) { handleBootstrap(r, s); });
  srv_.Post("/api/sessions", [this](const auto& r, auto& s) { handleSessions(r, s); });
  srv_.Get("/api/sessions", [this](const auto& r, auto& s) { handleBootstrap(r, s); });
  srv_.Get(R"(/api/sessions/([A-Za-z0-9_\-]+))",
           [this](const auto& r, auto& s) { handleSessionDetail(r, s); });
  srv_.Delete(R"(/api/sessions/([A-Za-z0-9_\-]+))",
              [this](const auto& r, auto& s) { handleDeleteSession(r, s); });
  srv_.Post(R"(/api/sessions/([A-Za-z0-9_\-]+)/rename)",
            [this](const auto& r, auto& s) { handleRename(r, s); });
  srv_.Post("/api/chat", [this](const auto& r, auto& s) { handleChat(r, s); });
  srv_.Post("/api/log", [](const httplib::Request& req, httplib::Response& res) {
    logf("[page] " + req.body.substr(0, 500));
    res.set_content("{}", "application/json");
  });
  srv_.Post("/api/permission", [this](const auto& r, auto& s) { handlePermission(r, s); });
  srv_.Post("/api/cancel", [this](const auto& r, auto& s) { handleCancel(r, s); });
  srv_.Get("/api/events", [this](const auto& r, auto& s) { handleStream(r, s); });
  srv_.Get("/api/catalog", [this](const auto& r, auto& s) { handleCatalog(r, s); });
  srv_.Get("/api/models", [this](const auto& r, auto& s) { handleModels(r, s); });
  srv_.Post("/api/model", [this](const auto& r, auto& s) { handleSetModel(r, s); });
  srv_.Get("/api/usage", [this](const auto& r, auto& s) { handleUsage(r, s); });
  srv_.Get("/api/workspaces", [this](const auto& r, auto& s) { handleWorkspaces(r, s); });
  srv_.Post("/api/workspaces/open", [this](const auto& r, auto& s) { handleWorkspaceOpen(r, s); });
  srv_.Post("/api/workspaces/use", [this](const auto& r, auto& s) { handleWorkspaceUse(r, s); });
  srv_.Post("/api/workspaces/pick", [this](const auto& r, auto& s) { handleWorkspacePick(r, s); });
  srv_.Post("/api/workspaces/create", [this](const auto& r, auto& s) { handleWorkspaceCreate(r, s); });
  srv_.Post("/api/workspaces/save", [this](const auto& r, auto& s) { handleWorkspaceSave(r, s); });
  srv_.Post("/api/workspaces/remove", [this](const auto& r, auto& s) { handleWorkspaceRemove(r, s); });
  srv_.Post("/api/projects/rename", [this](const auto& r, auto& s) { handleProjectRename(r, s); });
  srv_.Post("/api/projects/apply", [this](const auto& r, auto& s) { handleProjectApply(r, s); });
  srv_.Post("/api/projects/ai-organize", [this](const auto& r, auto& s) { handleAiOrganize(r, s); });
  srv_.Get(R"(/api/images/([A-Za-z0-9_.\-]+))",
           [this](const auto& r, auto& s) { handleImage(r, s); });
  srv_.Get("/api/file", [this](const auto& r, auto& s) { handleFile(r, s); });
  srv_.Get("/api/iui", [this](const auto& r, auto& s) { handleIuiGet(r, s); });
  srv_.Post("/api/iui", [this](const auto& r, auto& s) { handleIuiSet(r, s); });
  srv_.Get(R"(/.*)", [this](const auto& r, auto& s) { handleStatic(r, s); });
}

}  // namespace wbl
