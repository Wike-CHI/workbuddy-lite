#include "catalog.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <set>
#include <sstream>
#include <vector>

namespace wbl {
namespace {

struct DirEntry {
  std::string name;
  bool isDir = false;
};

std::string homeDir() {
  const char* p = getenv("USERPROFILE");
  return p ? p : "";
}

std::string joinPath(const std::string& a, const std::string& b) {
  if (a.empty()) return b;
  if (b.empty()) return a;
  char last = a.back();
  if (last == '\\' || last == '/') return a + b;
  return a + "\\" + b;
}

bool isFile(const std::string& path) {
  DWORD attr = GetFileAttributesW(utf8ToWide(path).c_str());
  return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY);
}

bool isDir(const std::string& path) {
  DWORD attr = GetFileAttributesW(utf8ToWide(path).c_str());
  return attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY);
}

std::string readText(const std::string& path, size_t maxBytes = 1 << 20) {
  std::ifstream in(utf8ToWide(path).c_str(), std::ios::binary);
  if (!in) return "";
  std::string s;
  s.resize(maxBytes);
  in.read(&s[0], static_cast<std::streamsize>(maxBytes));
  s.resize(static_cast<size_t>(in.gcount()));
  // 带 BOM 的 JSON 直接 parse 会失败，先摘掉
  if (s.size() >= 3 && static_cast<unsigned char>(s[0]) == 0xEF &&
      static_cast<unsigned char>(s[1]) == 0xBB && static_cast<unsigned char>(s[2]) == 0xBF) {
    s.erase(0, 3);
  }
  return s;
}

json readJson(const std::string& path) {
  std::string text = readText(path);
  if (text.empty()) return json::object();
  json doc = json::parse(text, nullptr, false);
  return (doc.is_discarded() || !doc.is_object()) ? json::object() : doc;
}

std::vector<DirEntry> listDir(const std::string& dir) {
  std::vector<DirEntry> out;
  std::wstring pattern = utf8ToWide(dir);
  if (pattern.empty()) return out;
  if (pattern.back() != L'\\' && pattern.back() != L'/') pattern += L'\\';
  pattern += L'*';

  WIN32_FIND_DATAW fd{};
  HANDLE h = FindFirstFileW(pattern.c_str(), &fd);
  if (h == INVALID_HANDLE_VALUE) return out;
  do {
    std::wstring name = fd.cFileName;
    if (name == L"." || name == L"..") continue;
    out.push_back({wideToUtf8(name), (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0});
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  return out;
}

std::string trim(const std::string& s) {
  size_t a = 0, b = s.size();
  while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\r' || s[a] == '\n')) ++a;
  while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\r' || s[b - 1] == '\n')) --b;
  return s.substr(a, b - a);
}

// 摘 YAML frontmatter 里的 name / description / argument-hint；
// SKILL.md 的正文不读，界面只需要能认出来的那几行
json readSkillMeta(const std::string& dir, const std::string& source) {
  std::string md = readText(joinPath(dir, "SKILL.md"), 64 * 1024);
  if (md.empty()) return json();

  json meta = {{"name", ""}, {"description", ""}, {"hint", ""}, {"source", source}, {"path", dir}};
  if (md.rfind("---", 0) == 0) {
    size_t first = md.find('\n');
    size_t end = first == std::string::npos ? std::string::npos : md.find("\n---", first);
    if (first != std::string::npos && end != std::string::npos) {
      std::string body = md.substr(first + 1, end - first - 1);
      std::istringstream ss(body);
      std::string line, lastName;
      while (std::getline(ss, line)) {
        if (!line.empty() && (line[0] == ' ' || line[0] == '\t') && !lastName.empty()) {
          // 多行续写的值，拼回上一行
          meta[lastName] = jstr(meta, lastName.c_str()) + " " + trim(line);
          continue;
        }
        size_t colon = line.find(':');
        if (colon == std::string::npos) continue;
        std::string key = trim(line.substr(0, colon));
        std::string val = trim(line.substr(colon + 1));
        if (val.size() >= 2 && (val.front() == '"' || val.front() == '\'') && val.back() == val.front()) {
          val = val.substr(1, val.size() - 2);
        }
        std::string jsonKey;
        if (key == "name") jsonKey = "name";
        else if (key == "description") jsonKey = "description";
        else if (key == "argument-hint") jsonKey = "hint";
        if (!jsonKey.empty()) {
          meta[jsonKey] = val;
          lastName = jsonKey;
        } else {
          lastName.clear();
        }
      }
    }
  }
  if (jstr(meta, "name").empty()) {
    size_t pos = dir.find_last_of("\\/");
    meta["name"] = pos == std::string::npos ? dir : dir.substr(pos + 1);
  }
  return meta;
}

void collectSkills(json& arr, std::set<std::string>& seen, const std::string& root,
                   const std::string& source) {
  for (const auto& e : listDir(root)) {
    std::string dir = joinPath(root, e.name);
    if (!isFile(joinPath(dir, "SKILL.md"))) continue;
    json meta = readSkillMeta(dir, source);
    if (meta.is_null()) continue;
    std::string name = jstr(meta, "name");
    if (name.empty() || seen.count(name)) continue;
    seen.insert(name);
    arr.push_back(meta);
  }
}

std::string mcpTarget(const json& server) {
  std::string url = jstr(server, "url");
  if (!url.empty()) return url;
  return jstr(server, "command");
}

void collectMcp(json& arr, std::set<std::string>& seen, const std::string& path,
                const std::string& scope) {
  json doc = readJson(path);
  json servers = jval(doc, "mcpServers", json::object());
  if (!servers.is_object()) return;
  for (auto it = servers.begin(); it != servers.end(); ++it) {
    const json& v = it.value();
    if (!v.is_object() || seen.count(it.key())) continue;
    seen.insert(it.key());
    std::string url = jstr(v, "url");
    json args = jval(v, "args", json::array());
    arr.push_back({{"name", it.key()},
                   {"scope", scope},
                   {"type", jstr(v, "type", url.empty() ? "stdio" : "http")},
                   {"target", mcpTarget(v)},
                   {"url", url},
                   {"args", args.is_array() ? args : json::array()},
                   {"disabled", v.value("disabled", false)},
                   {"configPath", path}});
  }
}

std::string marketOf(const std::string& key) {
  size_t at = key.find('@');
  return at == std::string::npos ? "" : key.substr(at + 1);
}

std::string pluginOf(const std::string& key) {
  size_t at = key.find('@');
  return at == std::string::npos ? key : key.substr(0, at);
}

}  // namespace

json listSubdirs(const std::string& dir, int maxItems) {
  json out = json::array();
  if (dir.empty()) return out;
  auto entries = listDir(dir);
  std::sort(entries.begin(), entries.end(), [](const DirEntry& a, const DirEntry& b) {
    std::string x = a.name, y = b.name;
    for (auto& c : x) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    for (auto& c : y) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return x < y;
  });
  static const std::set<std::string> skip = {"node_modules", ".git", ".svn", "dist", "build",
                                             "obj", ".next", ".cache", "target", "out", "bin"};
  for (const auto& e : entries) {
    if (!e.isDir) continue;
    std::string lower = e.name;
    for (auto& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (lower.empty() || lower[0] == '.' || skip.count(lower)) continue;
    out.push_back({{"name", e.name}, {"path", joinPath(dir, e.name)}});
    if (static_cast<int>(out.size()) >= maxItems) break;
  }
  return out;
}

json buildCatalog(const std::string& cwd) {
  const std::string home = homeDir();
  const std::string cbDir = joinPath(home, ".codebuddy");

  json skills = json::array();
  std::set<std::string> skillSeen;
  collectSkills(skills, skillSeen, joinPath(cwd, ".codebuddy\\skills"), "project");
  collectSkills(skills, skillSeen, joinPath(cwd, ".claude\\skills"), "project");
  collectSkills(skills, skillSeen, joinPath(cbDir, "skills"), "user");

  json connectors = json::array();
  std::set<std::string> mcpSeen;
  collectMcp(connectors, mcpSeen, joinPath(cwd, ".mcp.json"), "project");
  collectMcp(connectors, mcpSeen, joinPath(cwd, ".codebuddy\\mcp.json"), "project");
  collectMcp(connectors, mcpSeen, joinPath(cbDir, "mcp.json"), "user");
  collectMcp(connectors, mcpSeen, joinPath(cbDir, ".mcp.json"), "user");

  json installed = jval(readJson(joinPath(home, ".codebuddy\\plugins\\installed_plugins.json")),
                        "plugins", json::object());
  json enabled = jval(readJson(joinPath(cbDir, "settings.json")), "enabledPlugins", json::object());
  json marketsDoc = readJson(joinPath(cbDir, "plugins\\known_marketplaces.json"));

  json plugins = json::array();
  json marketplaces = json::array();
  std::set<std::string> pluginSeen;

  if (marketsDoc.is_object()) {
    for (auto it = marketsDoc.begin(); it != marketsDoc.end(); ++it) {
      const json& m = it.value();
      if (!m.is_object()) continue;
      std::string mName = jstr(m, "manifestName", it.key());
      std::string installLoc = jstr(m, "installLocation");
      json manifest = readJson(joinPath(installLoc, ".codebuddy-plugin\\marketplace.json"));

      json list = jval(manifest, "plugins", json::array());
      int count = list.is_array() ? static_cast<int>(list.size()) : 0;
      marketplaces.push_back({{"name", mName},
                              {"description", jstr(manifest, "description", jstr(m, "description"))},
                              {"pluginCount", count},
                              {"installLocation", installLoc}});

      if (!list.is_array()) continue;
      for (const auto& p : list) {
        if (!p.is_object()) continue;
        std::string pName = jstr(p, "name");
        if (pName.empty()) continue;
        std::string key = pName + "@" + mName;
        if (pluginSeen.count(key)) continue;
        pluginSeen.insert(key);
        plugins.push_back({{"name", pName},
                           {"marketplace", mName},
                           {"description", jstr(p, "description", jstr(p, "description_en"))},
                           {"version", jstr(p, "version")},
                           {"category", jstr(p, "category")},
                           {"author", jstr(jval(p, "author", json::object()), "name")},
                           {"installed", installed.is_object() && installed.contains(key)},
                           {"enabled", enabled.is_object() && enabled.value(key, false)},
                           {"key", key}});
      }
    }
  }

  // 市场清单里没有、但 installed_plugins.json 里存在的（例如内置插件）
  if (installed.is_object()) {
    for (auto it = installed.begin(); it != installed.end(); ++it) {
      const std::string& key = it.key();
      if (pluginSeen.count(key)) continue;
      pluginSeen.insert(key);
      std::string mName = marketOf(key);
      plugins.push_back({{"name", pluginOf(key)},
                         {"marketplace", mName},
                         {"description", ""},
                         {"version", ""},
                         {"category", ""},
                         {"author", ""},
                         {"installed", true},
                         {"enabled", enabled.is_object() && enabled.value(key, false)},
                         {"key", key}});
    }
  }

  return json{{"cwd", cwd},
              {"skills", skills},
              {"connectors", connectors},
              {"plugins", plugins},
              {"marketplaces", marketplaces},
              {"codebuddyDir", cbDir},
              {"loadedAt", nowMs()}};
}

}  // namespace wbl
