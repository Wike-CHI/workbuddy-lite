// 从本机 Chrome 的 Cookies 数据库里读出登录态（Windows v10 加密）。
// Chrome 运行时会独占 Cookies 文件，所以只能在完全退出 Chrome 后导入。
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace wbl {

struct ChromeCookie {
  std::string name;
  std::string value;
  std::string domain;
  std::string path;
  int64_t expiresUnix = 0;  // 0 = 会话 Cookie
  bool secure = false;
  bool httpOnly = false;
  int sameSite = -1;  // -1 未指定 / 0 None / 1 Lax / 2 Strict
};

struct ChromeImportResult {
  bool ok = false;
  std::string error;
  int total = 0;
  int decrypted = 0;
  int skipped = 0;  // v20（app-bound 加密）或空值
  std::vector<ChromeCookie> cookies;
};

// 读取 %LOCALAPPDATA%\Google\Chrome\User Data 下的登录态
ChromeImportResult loadChromeCookies();

}  // namespace wbl
