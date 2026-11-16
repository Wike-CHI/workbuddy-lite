// Win32 宿主：后端跑在后台线程，界面用 WebView2 加载本地页面。
#include "common.h"

#include <shellapi.h>
#include <shobjidl.h>
#include <wrl.h>

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <vector>

// gdiplus.h 在 NOMINMAX 下会用到 min/max 宏
#ifndef min
#define min(a, b) (((a) < (b)) ? (a) : (b))
#endif
#ifndef max
#define max(a, b) (((a) > (b)) ? (a) : (b))
#endif
#include <gdiplus.h>
#undef min
#undef max

#include "WebView2.h"
#include "backend.h"

#pragma comment(lib, "WebView2LoaderStatic.lib")
#pragma comment(lib, "gdiplus.lib")

using namespace Microsoft::WRL;

namespace {

const wchar_t* kClassName = L"WorkBuddyLiteWindow";

struct AppState {
  wbl::Backend* backend = nullptr;
  ICoreWebView2Controller* controller = nullptr;
  ICoreWebView2* webview = nullptr;
  std::string baseUrl;
  std::string shotPath;
  std::string winShotPath;
  std::string autoText;
  std::string clickId;
  int clickDelayMs = 0;
  std::string evalScript;

  HICON iconLarge = nullptr;
  HICON iconSmall = nullptr;
  bool ownIcons = false;
  bool iconsFromResource = false;
  bool trayAdded = false;
  std::wstring trayTip = L"WorkBuddy Lite";

  // 右栏内嵌浏览器：独立子窗口 + 第二个 WebView2 控制器
  ICoreWebView2Environment* env = nullptr;
  HWND browserHost = nullptr;
  ICoreWebView2Controller* browserController = nullptr;
  ICoreWebView2* browserView = nullptr;
  bool browserVisible = false;
  int browserX = 0;
  int browserY = 0;
  int browserW = 0;
  int browserH = 0;
  double browserDpr = 1.0;
  std::wstring browserUrl;
};

AppState g_app;

constexpr UINT WM_APP_CAPTURE = WM_APP + 1;
constexpr UINT WM_APP_AUTO = WM_APP + 2;
constexpr UINT WM_APP_TRAY = WM_APP + 3;

constexpr UINT ID_TRAY_TOGGLE = 1;
constexpr UINT ID_TRAY_NEW = 2;
constexpr UINT ID_TRAY_FOLDER = 3;
constexpr UINT ID_TRAY_EXIT = 4;

UINT g_taskbarCreated = 0;
ULONG_PTR g_gdiplusToken = 0;

void capturePreview(ICoreWebView2* webview, const std::string& outPath, HWND hwnd);

std::string getArgValue(const std::string& name, const std::string& def) {
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!argv) return def;
  std::string out = def;
  std::wstring wname = wbl::utf8ToWide(name);
  for (int i = 1; i + 1 < argc; ++i) {
    if (wname == argv[i]) {
      out = wbl::wideToUtf8(argv[i + 1]);
      break;
    }
  }
  LocalFree(argv);
  return out;
}

bool hasFlag(const std::string& name) {
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!argv) return false;
  std::wstring wname = wbl::utf8ToWide(name);
  bool found = false;
  for (int i = 1; i < argc; ++i) {
    if (wname == argv[i]) {
      found = true;
      break;
    }
  }
  LocalFree(argv);
  return found;
}

int GetEncoderClsid(const WCHAR* format, CLSID* pClsid) {
  UINT num = 0;
  UINT size = 0;
  Gdiplus::GetImageEncodersSize(&num, &size);
  if (size == 0) return -1;
  std::vector<BYTE> buffer(size);
  auto* codecs = reinterpret_cast<Gdiplus::ImageCodecInfo*>(buffer.data());
  Gdiplus::GetImageEncoders(num, size, codecs);
  for (UINT i = 0; i < num; ++i) {
    if (wcscmp(codecs[i].MimeType, format) == 0) {
      *pClsid = codecs[i].Clsid;
      return static_cast<int>(i);
    }
  }
  return -1;
}

// 整窗截图：WebView2 的 CapturePreview 拍不到子窗口（右栏内嵌浏览器）
bool captureWindowToFile(HWND hwnd, const std::string& path) {
  RECT rc{};
  if (!GetWindowRect(hwnd, &rc)) return false;
  const int w = rc.right - rc.left;
  const int h = rc.bottom - rc.top;
  if (w <= 0 || h <= 0) return false;

  HDC screen = GetDC(nullptr);
  HDC mem = CreateCompatibleDC(screen);
  HBITMAP bmp = CreateCompatibleBitmap(screen, w, h);
  HGDIOBJ old = SelectObject(mem, bmp);
  // 先用 PrintWindow：窗口被别的程序挡住时也能拍到自己的内容
  BOOL ok = PrintWindow(hwnd, mem, 2 /*PW_RENDERFULLCONTENT*/);
  if (!ok) ok = BitBlt(mem, 0, 0, w, h, screen, rc.left, rc.top, SRCCOPY | CAPTUREBLT);
  SelectObject(mem, old);
  DeleteDC(mem);
  ReleaseDC(nullptr, screen);
  if (!ok) {
    DeleteObject(bmp);
    return false;
  }

  bool saved = false;
  {
    Gdiplus::Bitmap image(bmp, nullptr);
    CLSID clsid{};
    if (GetEncoderClsid(L"image/png", &clsid) >= 0) {
      saved = image.Save(wbl::utf8ToWide(path).c_str(), &clsid, nullptr) == Gdiplus::Ok;
    }
  }
  DeleteObject(bmp);
  return saved;
}

void resizeWebView(HWND hwnd) {
  if (!g_app.controller) return;
  RECT rc;
  GetClientRect(hwnd, &rc);
  g_app.controller->put_Bounds(rc);
}

// 右栏内嵌浏览器
LRESULT CALLBACK BrowserHostProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  return DefWindowProcW(hwnd, msg, wp, lp);
}

void ensureBrowserHost(HWND parent) {
  if (g_app.browserHost) return;
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = BrowserHostProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  wc.hbrBackground = CreateSolidBrush(RGB(255, 255, 255));
  wc.lpszClassName = L"WBLBrowserHost";
  RegisterClassExW(&wc);
  g_app.browserHost =
      CreateWindowExW(0, L"WBLBrowserHost", L"", WS_CHILD | WS_CLIPCHILDREN, 0, 0, 10, 10, parent, nullptr,
                      GetModuleHandleW(nullptr), nullptr);
}

void postBrowserState() {
  if (!g_app.webview || !g_app.browserView) return;
  LPWSTR src = nullptr;
  g_app.browserView->get_Source(&src);
  LPWSTR title = nullptr;
  g_app.browserView->get_DocumentTitle(&title);
  BOOL back = FALSE;
  BOOL forward = FALSE;
  g_app.browserView->get_CanGoBack(&back);
  g_app.browserView->get_CanGoForward(&forward);
  json state = {{"type", "browser-state"},
                {"url", src ? wbl::wideToUtf8(src) : ""},
                {"title", title ? wbl::wideToUtf8(title) : ""},
                {"canGoBack", back != FALSE},
                {"canGoForward", forward != FALSE}};
  if (src) CoTaskMemFree(src);
  if (title) CoTaskMemFree(title);
  std::wstring payload = wbl::utf8ToWide(state.dump());
  g_app.webview->PostWebMessageAsJson(payload.c_str());
}

void layoutBrowser() {
  if (!g_app.browserHost) return;
  const int px = static_cast<int>(g_app.browserX * g_app.browserDpr + 0.5);
  const int py = static_cast<int>(g_app.browserY * g_app.browserDpr + 0.5);
  const int pw = static_cast<int>(g_app.browserW * g_app.browserDpr + 0.5);
  const int ph = static_cast<int>(g_app.browserH * g_app.browserDpr + 0.5);
  SetWindowPos(g_app.browserHost, HWND_TOP, px, py, pw, ph,
               SWP_NOACTIVATE | (g_app.browserVisible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW));
  if (g_app.browserController) {
    RECT bounds{0, 0, static_cast<LONG>(g_app.browserW), static_cast<LONG>(g_app.browserH)};
    g_app.browserController->put_Bounds(bounds);
  }
}

void createBrowserController() {
  if (!g_app.env || !g_app.browserHost || g_app.browserController) return;
  g_app.env->CreateCoreWebView2Controller(
      g_app.browserHost,
      Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
          [](HRESULT hr, ICoreWebView2Controller* controller) -> HRESULT {
            if (FAILED(hr) || !controller) {
              wbl::logf("创建浏览器 WebView2 控制器失败 hr=" + std::to_string(hr));
              return hr;
            }
            g_app.browserController = controller;
            controller->AddRef();
            controller->put_IsVisible(g_app.browserVisible ? TRUE : FALSE);
            RECT bounds{0, 0, static_cast<LONG>(g_app.browserW), static_cast<LONG>(g_app.browserH)};
            controller->put_Bounds(bounds);

            ICoreWebView2* view = nullptr;
            controller->get_CoreWebView2(&view);
            if (!view) return S_OK;
            g_app.browserView = view;
            view->AddRef();

            ICoreWebView2Settings* settings = nullptr;
            view->get_Settings(&settings);
            if (settings) {
              settings->put_AreDefaultContextMenusEnabled(TRUE);
              settings->put_IsStatusBarEnabled(FALSE);
              settings->put_AreDevToolsEnabled(TRUE);
              settings->Release();
            }

            EventRegistrationToken token{};
            view->add_NavigationCompleted(
                Callback<ICoreWebView2NavigationCompletedEventHandler>(
                    [](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                      BOOL ok = FALSE;
                      args->get_IsSuccess(&ok);
                      wbl::logf(ok ? "browser navigation ok" : "browser navigation failed");
                      postBrowserState();
                      return S_OK;
                    })
                    .Get(),
                &token);
            view->add_DocumentTitleChanged(
                Callback<ICoreWebView2DocumentTitleChangedEventHandler>(
                    [](ICoreWebView2*, IUnknown*) -> HRESULT {
                      postBrowserState();
                      return S_OK;
                    })
                    .Get(),
                &token);
            view->add_NewWindowRequested(
                Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                    [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                      LPWSTR uri = nullptr;
                      args->get_Uri(&uri);
                      args->put_Handled(TRUE);
                      if (uri && g_app.browserView) g_app.browserView->Navigate(uri);
                      if (uri) CoTaskMemFree(uri);
                      return S_OK;
                    })
                    .Get(),
                &token);

            if (!g_app.browserUrl.empty()) view->Navigate(g_app.browserUrl.c_str());
            wbl::logf("browser webview ready");
            return S_OK;
          })
          .Get());
}

void showBrowser(HWND parent, const std::wstring& url) {
  ensureBrowserHost(parent);
  if (!g_app.browserHost) return;
  if (!url.empty()) g_app.browserUrl = url;
  g_app.browserVisible = true;
  wbl::logf("browser show " + std::to_string(g_app.browserX) + "," + std::to_string(g_app.browserY) + " " +
            std::to_string(g_app.browserW) + "x" + std::to_string(g_app.browserH) + " dpr=" +
            std::to_string(g_app.browserDpr));
  ShowWindow(g_app.browserHost, SW_SHOW);
  layoutBrowser();
  if (!g_app.browserController) {
    createBrowserController();
  } else {
    g_app.browserController->put_IsVisible(TRUE);
    if (g_app.browserView && !url.empty()) g_app.browserView->Navigate(url.c_str());
  }
}

void hideBrowser() {
  g_app.browserVisible = false;
  if (g_app.browserHost) ShowWindow(g_app.browserHost, SW_HIDE);
  if (g_app.browserController) g_app.browserController->put_IsVisible(FALSE);
}


HICON createAppIcon(int size) {
  using namespace Gdiplus;
  Bitmap bmp(size, size, PixelFormat32bppARGB);
  Graphics g(&bmp);
  g.SetSmoothingMode(SmoothingModeAntiAlias);
  g.SetTextRenderingHint(TextRenderingHintAntiAlias);
  g.Clear(Color(0, 0, 0, 0));

  const REAL pad = size * 0.06f;
  const REAL radius = size * 0.22f;
  GraphicsPath path;
  path.AddArc(pad, pad, radius * 2, radius * 2, 180, 90);
  path.AddArc(size - pad - radius * 2, pad, radius * 2, radius * 2, 270, 90);
  path.AddArc(size - pad - radius * 2, size - pad - radius * 2, radius * 2, radius * 2, 0, 90);
  path.AddArc(pad, size - pad - radius * 2, radius * 2, radius * 2, 90, 90);
  path.CloseFigure();

  SolidBrush blue(Color(255, 47, 111, 235));
  g.FillPath(&blue, &path);

  FontFamily family(L"Segoe UI");
  Font font(&family, static_cast<REAL>(size) * 0.52f, FontStyleBold, UnitPixel);
  StringFormat format;
  format.SetAlignment(StringAlignmentCenter);
  format.SetLineAlignment(StringAlignmentCenter);
  SolidBrush white(Color(255, 255, 255));
  g.DrawString(L"W", -1, &font, RectF(0, 0, static_cast<REAL>(size), static_cast<REAL>(size)), &format, &white);

  HICON icon = nullptr;
  bmp.GetHICON(&icon);
  return icon;
}

void initIcons() {
  HMODULE module = GetModuleHandleW(nullptr);
  HICON resLarge = reinterpret_cast<HICON>(LoadImageW(module, MAKEINTRESOURCEW(1), IMAGE_ICON, 64, 64, LR_DEFAULTCOLOR));
  HICON resSmall = reinterpret_cast<HICON>(LoadImageW(module, MAKEINTRESOURCEW(1), IMAGE_ICON, 32, 32, LR_DEFAULTCOLOR));
  if (resLarge && resSmall) {
    g_app.iconLarge = resLarge;
    g_app.iconSmall = resSmall;
    g_app.ownIcons = true;
    g_app.iconsFromResource = true;
    return;
  }
  if (resLarge) DestroyIcon(resLarge);
  if (resSmall) DestroyIcon(resSmall);

  if (g_gdiplusToken) {
    g_app.iconLarge = createAppIcon(64);
    g_app.iconSmall = createAppIcon(32);
  }
  if (g_app.iconLarge && g_app.iconSmall) {
    g_app.ownIcons = true;
    return;
  }
  if (g_app.iconLarge) DestroyIcon(g_app.iconLarge);
  if (g_app.iconSmall) DestroyIcon(g_app.iconSmall);
  g_app.iconLarge = LoadIconW(nullptr, MAKEINTRESOURCEW(32512));
  g_app.iconSmall = g_app.iconLarge;
  g_app.ownIcons = false;
}

std::wstring currentDirW() {
  wchar_t buf[MAX_PATH] = {0};
  GetCurrentDirectoryW(MAX_PATH, buf);
  return buf;
}

void addTrayIcon(HWND hwnd) {
  if (g_app.trayAdded) return;
  NOTIFYICONDATAW nid{};
  nid.cbSize = sizeof(nid);
  nid.hWnd = hwnd;
  nid.uID = 1;
  nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP;
  nid.uCallbackMessage = WM_APP_TRAY;
  nid.hIcon = g_app.iconSmall ? g_app.iconSmall : g_app.iconLarge;
  wcsncpy_s(nid.szTip, g_app.trayTip.c_str(), _TRUNCATE);
  if (Shell_NotifyIconW(NIM_ADD, &nid)) {
    g_app.trayAdded = true;
    nid.uVersion = NOTIFYICON_VERSION_4;
    Shell_NotifyIconW(NIM_SETVERSION, &nid);
    wbl::logf("tray icon added");
  } else {
    wbl::logf("tray icon add failed");
  }
}

void removeTrayIcon(HWND hwnd) {
  if (!g_app.trayAdded) return;
  NOTIFYICONDATAW nid{};
  nid.cbSize = sizeof(nid);
  nid.hWnd = hwnd;
  nid.uID = 1;
  Shell_NotifyIconW(NIM_DELETE, &nid);
  g_app.trayAdded = false;
}

void toggleMainWindow(HWND hwnd) {
  if (IsWindowVisible(hwnd) && !IsIconic(hwnd)) {
    ShowWindow(hwnd, SW_HIDE);
  } else {
    ShowWindow(hwnd, SW_SHOW);
    ShowWindow(hwnd, SW_RESTORE);
    SetForegroundWindow(hwnd);
  }
}

void spawnNewWindow() {
  wchar_t exe[MAX_PATH] = {0};
  GetModuleFileNameW(nullptr, exe, MAX_PATH);
  std::string backendCwd = g_app.backend ? g_app.backend->currentWorkspace() : "";
  const std::wstring cwd = backendCwd.empty() ? currentDirW() : wbl::utf8ToWide(backendCwd);
  std::wstring cmd = L"\"" + std::wstring(exe) + L"\" --cwd \"" + cwd + L"\" --new-window";
  STARTUPINFOW si{};
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESHOWWINDOW;
  si.wShowWindow = SW_SHOWNORMAL;
  PROCESS_INFORMATION pi{};
  std::vector<wchar_t> buf(cmd.begin(), cmd.end());
  buf.push_back(L'\0');
  if (CreateProcessW(nullptr, buf.data(), nullptr, nullptr, FALSE, 0, nullptr, cwd.c_str(), &si, &pi)) {
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
  } else {
    wbl::logf("tray new window failed code=" + std::to_string(GetLastError()));
  }
}

void openCurrentFolder() {
  std::string backendCwd = g_app.backend ? g_app.backend->currentWorkspace() : "";
  const std::wstring cwd = backendCwd.empty() ? currentDirW() : wbl::utf8ToWide(backendCwd);
  HINSTANCE r = ShellExecuteW(nullptr, L"open", cwd.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  if (reinterpret_cast<INT_PTR>(r) <= 32) {
    wbl::logf("open current folder failed code=" + std::to_string(reinterpret_cast<INT_PTR>(r)));
  }
}

void showTrayMenu(HWND hwnd) {
  HMENU menu = CreatePopupMenu();
  if (!menu) return;
  const bool visible = IsWindowVisible(hwnd) && !IsIconic(hwnd);
  AppendMenuW(menu, MF_STRING, ID_TRAY_TOGGLE, visible ? L"隐藏到托盘" : L"显示窗口");
  AppendMenuW(menu, MF_STRING, ID_TRAY_NEW, L"新建窗口");
  AppendMenuW(menu, MF_STRING, ID_TRAY_FOLDER, L"打开工作目录");
  AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(menu, MF_STRING, ID_TRAY_EXIT, L"退出");

  POINT pt{};
  GetCursorPos(&pt);
  SetForegroundWindow(hwnd);
  const UINT cmd = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.x, pt.y, 0, hwnd, nullptr);
  DestroyMenu(menu);

  if (cmd == ID_TRAY_TOGGLE) toggleMainWindow(hwnd);
  else if (cmd == ID_TRAY_NEW) spawnNewWindow();
  else if (cmd == ID_TRAY_FOLDER) openCurrentFolder();
  else if (cmd == ID_TRAY_EXIT) DestroyWindow(hwnd);
  PostMessageW(hwnd, WM_NULL, 0, 0);
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  if (g_taskbarCreated && msg == g_taskbarCreated) {
    // Explorer 重启后托盘图标会消失，收到 TaskbarCreated 时重新注册
    g_app.trayAdded = false;
    addTrayIcon(hwnd);
    return 0;
  }
  switch (msg) {
    case WM_SIZE:
      resizeWebView(hwnd);
      return 0;
    case WM_APP_TRAY: {
      const UINT event = LOWORD(lp);
      if (event == WM_LBUTTONDBLCLK || event == NIN_SELECT || event == NIN_KEYSELECT) {
        ShowWindow(hwnd, SW_SHOW);
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
      } else if (event == WM_RBUTTONUP || event == WM_CONTEXTMENU) {
        showTrayMenu(hwnd);
      }
      return 0;
    }
    case WM_APP_CAPTURE:
      if (!g_app.winShotPath.empty()) {
        bool ok = captureWindowToFile(hwnd, g_app.winShotPath);
        wbl::logf(ok ? "winshot ok -> " + g_app.winShotPath : "winshot failed");
      } else if (g_app.webview && !g_app.shotPath.empty()) {
        capturePreview(g_app.webview, g_app.shotPath, hwnd);
      }
      return 0;
    case WM_APP_AUTO:
      // 走真实 UI 路径：先开新会话（避免续接上次会话污染验证），再填输入框 + 点发送
      if (g_app.webview && !g_app.evalScript.empty()) {
        g_app.webview->ExecuteScript(wbl::utf8ToWide(g_app.evalScript).c_str(), nullptr);
      }
      if (g_app.webview && !g_app.autoText.empty()) {
        std::string q;
        for (char c : g_app.autoText) {
          if (c == '\\' || c == '"') q += '\\';
          q += c;
        }
        std::wstring script =
            L"(function(){var nb=document.getElementById('new-session');if(nb)nb.click();"
            L"setTimeout(function(){var i=document.getElementById('input');i.value=\"" +
            wbl::utf8ToWide(q) +
            L"\";i.dispatchEvent(new Event('input'));document.getElementById('send').click();},500);";
        if (!g_app.clickId.empty()) {
          script += L"setTimeout(function(){var x=document.getElementById(\"" + wbl::utf8ToWide(g_app.clickId) +
                    L"\");if(x)x.click();}," + std::to_wstring(g_app.clickDelayMs) + L");";
        }
        script += L"})()";
        g_app.webview->ExecuteScript(script.c_str(), nullptr);
      }
      return 0;
    case WM_DESTROY:
      if (g_app.browserController) {
        g_app.browserController->Close();
        g_app.browserController->Release();
        g_app.browserController = nullptr;
      }
      if (g_app.browserView) {
        g_app.browserView->Release();
        g_app.browserView = nullptr;
      }
      if (g_app.env) {
        g_app.env->Release();
        g_app.env = nullptr;
      }
      removeTrayIcon(hwnd);
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

std::wstring exeDirW() {
  wchar_t buf[MAX_PATH] = {0};
  GetModuleFileNameW(nullptr, buf, MAX_PATH);
  std::wstring p(buf);
  size_t pos = p.find_last_of(L"\\/");
  return pos == std::wstring::npos ? L"." : p.substr(0, pos);
}

bool fileExistsW(const std::wstring& path) {
  DWORD attr = GetFileAttributesW(path.c_str());
  return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY);
}

// 前端不走「编译期拷进 bin」，而是运行时按目录找：
// 源码树里优先用 bin\..\web，改完刷新页面就生效；分发包只有 bin\web 时退回它。
std::string resolveWebRoot() {
  std::string explicitRoot = getArgValue("--web", "");
  if (!explicitRoot.empty()) return explicitRoot;

  std::wstring beside = exeDirW() + L"\\web";
  std::wstring source = exeDirW() + L"\\..\\web";
  if (fileExistsW(source + L"\\index.html")) return wbl::wideToUtf8(source);
  return wbl::wideToUtf8(beside);
}

// 多窗口时每个进程用独立的 WebView2 数据目录，避免浏览器进程抢同一个 user data folder。
// 启动时顺手清掉两天前的旧目录，防止越开越多。
void cleanupWebViewData(const std::wstring& dataDir) {
  namespace fs = std::filesystem;
  std::error_code ec;
  if (!fs::is_directory(dataDir, ec)) return;
  auto now = fs::file_time_type::clock::now();
  for (const auto& entry : fs::directory_iterator(dataDir, ec)) {
    if (ec) break;
    if (!entry.is_directory(ec)) continue;
    std::wstring name = entry.path().filename().wstring();
    if (name.rfind(L"WebView2-", 0) != 0) continue;
    // 目录名带 PID；进程还活着就别删，避免误伤跑了两天的窗口
    DWORD pid = static_cast<DWORD>(_wtoi(name.c_str() + 9));
    if (pid) {
      HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
      if (h) {
        CloseHandle(h);
        continue;
      }
    }
    auto written = fs::last_write_time(entry.path(), ec);
    if (ec) continue;
    if (now - written > std::chrono::hours(48)) fs::remove_all(entry.path(), ec);
  }
}

// 调试用：把当前页面截成 PNG（验证 UI 时用，正常使用不会触发）
void capturePreview(ICoreWebView2* webview, const std::string& outPath, HWND hwnd) {
  IStream* stream = nullptr;
  if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream)) || !stream) return;
  webview->AddRef();
  auto handler = Callback<ICoreWebView2CapturePreviewCompletedHandler>(
      [webview, stream, outPath, hwnd](HRESULT hr) -> HRESULT {
        if (SUCCEEDED(hr)) {
          HGLOBAL mem = nullptr;
          if (SUCCEEDED(GetHGlobalFromStream(stream, &mem))) {
            void* data = GlobalLock(mem);
            SIZE_T size = GlobalSize(mem);
            if (data && size) {
              FILE* f = nullptr;
              if (fopen_s(&f, outPath.c_str(), "wb") == 0) {
                fwrite(data, 1, size, f);
                fclose(f);
              }
            }
            GlobalUnlock(mem);
          }
          wbl::logf("capture ok -> " + outPath);
        } else {
          wbl::logf("capture failed hr=" + std::to_string(hr));
        }
        stream->Release();
        webview->Release();
        PostMessageW(hwnd, WM_CLOSE, 0, 0);
        return S_OK;
      });
  HRESULT hr = webview->CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, stream, handler.Get());
  if (FAILED(hr)) {
    wbl::logf("CapturePreview 调用失败 hr=" + std::to_string(hr));
    stream->Release();
    webview->Release();
    PostMessageW(hwnd, WM_CLOSE, 0, 0);
  }
}

}  // namespace

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, LPWSTR, int) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  SetCurrentProcessExplicitAppUserModelID(L"WorkBuddy.Lite");
  {
    Gdiplus::GdiplusStartupInput input;
    if (Gdiplus::GdiplusStartup(&g_gdiplusToken, &input, nullptr) != Gdiplus::Ok) {
      g_gdiplusToken = 0;
    }
  }

  bool demo = hasFlag("--demo");
  bool fresh = hasFlag("--new-window") || hasFlag("--fresh");
  // 缺省留空：由 Backend 恢复上次用的工作空间（只有 --new-window 才显式带 --cwd）
  std::string cwd = getArgValue("--cwd", "");
  std::string webRoot = resolveWebRoot();

  std::string dataDir;
  const char* dataOverride = getenv("WORKBUDDY_LITE_DATA");
  if (dataOverride && *dataOverride) {
    dataDir = dataOverride;
  } else {
    dataDir = wbl::wideToUtf8(exeDirW()) + "\\data";
  }
  CreateDirectoryA(dataDir.c_str(), nullptr);
  wbl::logInit(dataDir + "\\app.log");
  wbl::logf("=== WorkBuddy Lite 启动 ===");
  wbl::logf("web=" + webRoot + (demo ? " demo=1" : "") + (fresh ? " fresh=1" : ""));
  initIcons();
  wbl::logf(g_app.iconsFromResource ? "app icons from resource" : (g_app.ownIcons ? "app icons created" : "app icons fallback"));
  {
    wchar_t self[MAX_PATH] = {0};
    GetModuleFileNameW(nullptr, self, MAX_PATH);
    HICON probeLarge = nullptr;
    HICON probeSmall = nullptr;
    UINT count = ExtractIconExW(self, 0, &probeLarge, &probeSmall, 1);
    wbl::logf("exe icon count=" + std::to_string(count));
    if (probeLarge) DestroyIcon(probeLarge);
    if (probeSmall) DestroyIcon(probeSmall);
  }

  wbl::Backend backend(demo, cwd, webRoot, fresh);
  if (!backend.start()) {
    MessageBoxW(nullptr, L"本地服务启动失败，请查看 data\\app.log", L"WorkBuddy Lite", MB_ICONERROR);
    return 1;
  }
  const std::string activeCwd = backend.currentWorkspace();
  wbl::logf("cwd=" + activeCwd);
  g_app.backend = &backend;
  g_app.baseUrl = backend.url();

  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = WndProc;
  wc.hInstance = hInst;
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  wc.hIcon = g_app.iconLarge;
  wc.hIconSm = g_app.iconSmall;
  wc.hbrBackground = CreateSolidBrush(RGB(246, 247, 249));
  wc.lpszClassName = kClassName;
  RegisterClassExW(&wc);
  g_taskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");

  std::wstring title = L"WorkBuddy Lite";
  {
    std::string wsName = backend.workspaceName();
    if (!wsName.empty()) title += L" · " + wbl::utf8ToWide(wsName);
  }
  HWND hwnd = CreateWindowExW(0, kClassName, title.c_str(), WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                              1280, 860, nullptr, nullptr, hInst, nullptr);
  if (!hwnd) return 1;
  SendMessageW(hwnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(g_app.iconLarge));
  SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(g_app.iconSmall));
  ShowWindow(hwnd, SW_SHOW);
  g_app.trayTip = title;
  addTrayIcon(hwnd);
  {
    auto bigIcon = reinterpret_cast<HICON>(SendMessageW(hwnd, WM_GETICON, ICON_BIG, 0));
    auto smallIcon = reinterpret_cast<HICON>(SendMessageW(hwnd, WM_GETICON, ICON_SMALL, 0));
    wbl::logf(std::string("window icons big=") + (bigIcon ? "1" : "0") + " small=" + (smallIcon ? "1" : "0"));
  }

  std::wstring dataRoot = exeDirW() + L"\\data";
  cleanupWebViewData(dataRoot);
  std::wstring userData = dataRoot + L"\\WebView2-" + std::to_wstring(GetCurrentProcessId());
  std::wstring url = wbl::utf8ToWide(backend.url());

  auto envHandler = Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
      [hwnd, url](HRESULT hr, ICoreWebView2Environment* env) -> HRESULT {
        if (FAILED(hr) || !env) {
          wbl::logf("创建 WebView2 环境失败");
          MessageBoxW(hwnd, L"WebView2 运行时初始化失败，请安装 Microsoft Edge WebView2 Runtime。",
                      L"WorkBuddy Lite", MB_ICONERROR);
          return hr;
        }
        g_app.env = env;
        env->AddRef();
        env->CreateCoreWebView2Controller(
            hwnd, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                      [hwnd, url](HRESULT hr2, ICoreWebView2Controller* controller) -> HRESULT {
                        if (FAILED(hr2) || !controller) {
                          wbl::logf("创建 WebView2 控制器失败");
                          return hr2;
                        }
                        g_app.controller = controller;
                        controller->AddRef();
                        resizeWebView(hwnd);
                        ICoreWebView2* webview = nullptr;
                        controller->get_CoreWebView2(&webview);
                        if (webview) {
                          ICoreWebView2Settings* settings = nullptr;
                          webview->get_Settings(&settings);
                          if (settings) {
                            settings->put_AreDefaultContextMenusEnabled(FALSE);
                            settings->put_IsStatusBarEnabled(FALSE);
                            settings->put_AreDevToolsEnabled(TRUE);
                            // 交给页面自己处理 Ctrl+N / Ctrl+K，别让 WebView 弹浏览器窗口
                            ICoreWebView2Settings3* settings3 = nullptr;
                            if (SUCCEEDED(settings->QueryInterface(IID_PPV_ARGS(&settings3))) && settings3) {
                              settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
                              settings3->Release();
                            }
                            settings->Release();
                          }

                          // 右栏浏览器：页面把自己的占位区域发过来，宿主把第二个 WebView2 摆上去
                          EventRegistrationToken msgToken{};
                          webview->add_WebMessageReceived(
                              Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                  [hwnd](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                    LPWSTR raw = nullptr;
                                    if (FAILED(args->get_WebMessageAsJson(&raw)) || !raw) return S_OK;
                                    json msg = json::parse(wbl::wideToUtf8(raw), nullptr, false);
                                    CoTaskMemFree(raw);
                                    if (msg.is_discarded() || !msg.is_object()) return S_OK;
                                    if (wbl::jstr(msg, "type") != "browser") return S_OK;

                                    std::string action = wbl::jstr(msg, "action");
                                    json bounds = msg.value("bounds", json::object());
                                    if (bounds.is_object()) {
                                      g_app.browserX = bounds.value("x", 0);
                                      g_app.browserY = bounds.value("y", 0);
                                      g_app.browserW = bounds.value("w", 0);
                                      g_app.browserH = bounds.value("h", 0);
                                    }
                                    double dpr = msg.value("dpr", 1.0);
                                    if (dpr > 0.2) g_app.browserDpr = dpr;
                                    std::string url = wbl::jstr(msg, "url");

                                    if (action == "show") {
                                      showBrowser(hwnd, wbl::utf8ToWide(url));
                                    } else if (action == "bounds") {
                                      layoutBrowser();
                                    } else if (action == "hide") {
                                      hideBrowser();
                                    } else if (action == "navigate" && g_app.browserView && !url.empty()) {
                                      g_app.browserUrl = wbl::utf8ToWide(url);
                                      g_app.browserView->Navigate(g_app.browserUrl.c_str());
                                    } else if (action == "reload" && g_app.browserView) {
                                      g_app.browserView->Reload();
                                    } else if (action == "back" && g_app.browserView) {
                                      g_app.browserView->GoBack();
                                    } else if (action == "forward" && g_app.browserView) {
                                      g_app.browserView->GoForward();
                                    }
                                    return S_OK;
                                  })
                                  .Get(),
                              &msgToken);

                          // 调试辅助：--auto 自动发一条消息，--shot 截图后退出，--wait 控制等待毫秒
                          std::string shotPath = getArgValue("--shot", "");
                          std::string winShot = getArgValue("--winshot", "");
                          std::string autoText = getArgValue("--auto", "");
                          int waitMs = 5000;
                          {
                            std::string w = getArgValue("--wait", "");
                            if (!w.empty()) waitMs = atoi(w.c_str());
                          }
                          if (!shotPath.empty() || !winShot.empty() || !autoText.empty()) {
                            g_app.webview = webview;
                            g_app.webview->AddRef();
                            g_app.shotPath = shotPath;
                            g_app.winShotPath = winShot;
                            g_app.autoText = autoText;
                            g_app.evalScript = getArgValue("--eval", "");
                            g_app.clickId = getArgValue("--click", "");
                            {
                              std::string at = getArgValue("--click-at", "");
                              if (!at.empty()) g_app.clickDelayMs = atoi(at.c_str());
                            }
                            EventRegistrationToken tok{};
                            webview->add_NavigationCompleted(
                                Callback<ICoreWebView2NavigationCompletedEventHandler>(
                                    [hwnd, waitMs](ICoreWebView2*,
                                                   ICoreWebView2NavigationCompletedEventArgs*) -> HRESULT {
                                      std::thread([hwnd, waitMs] {
                                        Sleep(900);
                                        PostMessageW(hwnd, WM_APP_AUTO, 0, 0);
                                        Sleep(waitMs);
                                        PostMessageW(hwnd, WM_APP_CAPTURE, 0, 0);
                                      }).detach();
                                      return S_OK;
                                    })
                                    .Get(),
                                &tok);
                          }

                          webview->Navigate(url.c_str());
                          webview->Release();
                        }
                        return S_OK;
                      })
                  .Get());
        return S_OK;
      });

  HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(nullptr, userData.c_str(), nullptr, envHandler.Get());
  if (FAILED(hr)) {
    wbl::logf("CreateCoreWebView2EnvironmentWithOptions 失败 hr=" + std::to_string(hr));
    MessageBoxW(hwnd, L"未检测到 WebView2 Runtime，请先安装后再运行。", L"WorkBuddy Lite", MB_ICONERROR);
    return 1;
  }

  MSG msg;
  while (GetMessage(&msg, nullptr, 0, 0)) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }

  if (g_app.controller) {
    g_app.controller->Close();
    g_app.controller->Release();
    g_app.controller = nullptr;
  }
  backend.stop();
  wbl::logf("=== 退出 ===");
  if (g_app.ownIcons) {
    if (g_app.iconLarge) DestroyIcon(g_app.iconLarge);
    if (g_app.iconSmall && g_app.iconSmall != g_app.iconLarge) DestroyIcon(g_app.iconSmall);
  }
  if (g_gdiplusToken) Gdiplus::GdiplusShutdown(g_gdiplusToken);
  return 0;
}
