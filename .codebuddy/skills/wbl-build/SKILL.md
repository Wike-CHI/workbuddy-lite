---
name: wbl-build
description: "workbuddy-lite 的构建流程：前端 tsc+vite 构建到 web/，后端用安全方式编出 bin/workbuddy-lite.verify.exe（不覆盖用户正在运行的 bin/workbuddy-lite.exe），需要发出正式包时才走 build.bat。改完代码要编译、编译报 LNK1104、或要确认产物落在哪里时使用。"
---

# 构建与安全编译

本项目的产物有两条路径，混用会踩坑：用户经常正开着 `bin/workbuddy-lite.exe` 在用，
而 Windows 不允许覆盖正在运行的可执行文件。

| 产物 | 命令 | 用途 |
|---|---|---|
| `web/` | `cd frontend && npm run build` | 前端静态资源；源码树运行时优先读这个目录 |
| `bin/workbuddy-lite.verify.exe` | `bash .codebuddy/skills/wbl-build/scripts/build-verify.sh` | 编译验证与截图验收，**默认走这条** |
| `bin/workbuddy-lite.exe` | `build.bat` | 正式产物；只在确认没有实例占用、准备发包时执行 |

运行时找前端的顺序是 `bin\..\web`（即仓库根的 `web/`）优先，找不到才退到 exe 同级的 `bin\web`。
所以本地改完前端只要重新 `npm run build`，重开 verify exe 就能看到新界面，不必拷贝到 `bin\web`。
`build.bat` 里的 `xcopy web bin\web` 是为分发准备的。

## 步骤 1：前端

```bash
cd frontend && npm run build
```

- `build` 是 `tsc -b && vite build`：先做类型检查，再打包。类型错误会在这里暴露，不要跳过。
- 首次运行如果缺 `node_modules`，`build-web.bat` 会 `npm install`；手动跑时先 `npm install`。
- 静态资源要拷贝到 `bin/web` 时：`rm -rf bin/web && cp -r web bin/web`（只在模拟分发包时用）。

## 步骤 2：后端（安全编译）

```bash
bash .codebuddy/skills/wbl-build/scripts/build-verify.sh
```

脚本做的事，和手动流程一致：

1. 读仓库根的 `build.bat`。
2. 把 `cd /d "%~dp0"` 改成仓库的绝对路径（脚本被复制到 `%TEMP%` 后，`%~dp0` 会指向临时目录）。
3. 把 `/Fe:bin\workbuddy-lite.exe` 改成 `/Fe:bin\workbuddy-lite.verify.exe`。
4. 写到 `%TEMP%/wbl-build-verify.bat` 并执行。

它只改输出文件名，编译参数、源文件列表、库列表全部沿用 `build.bat`，所以不会出现
「verify 编过了、正式构建却编不过」的偏差。

需要手动执行时，照这四条改一遍即可；**不要**直接跑 `build.bat` 验证，除非确认 exe 没被占用。

## 步骤 3：正式产物（谨慎）

**需要应用更新时编到 next，不要覆盖运行中的 exe**：把构建产物复制成 `bin/workbuddy-lite.next.exe`，
再调 `POST /api/app/restart`，由 `bin/workbuddy-updater.exe` 在进程退出后替换（见 `docs/self-update.md`）。

`build.bat` 只有在下面条件都满足时才跑：

- 用户明确说要发包、或要更新 `bin/workbuddy-lite.exe`；
- 没有正在运行的 `workbuddy-lite.exe`（任务管理器里能看到，或链接时报 LNK1104）。

如果链接时报 `LNK1104: 无法打开文件“bin\workbuddy-lite.exe”`，说明有实例占用：
**不要结束进程**，改用 verify 路径验证编译，并在报告里说明「正式产物待用户关闭窗口后再出」。

## 失败对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| `LNK1104` / `cannot open ...workbuddy-lite.exe` | 正式 exe 正在运行 | 改用 `build-verify.sh`；不杀进程 |
| `vcvars64.bat not found` | 没装 VS2022 C++ 工具链 | 报告环境缺失，不要改 `build.bat` 里的路径 |
| `rc.exe` 失败 | `src/app.rc` 或 `src/app.ico` 缺失 | 检查文件是否存在，缺了就报告 |
| `tsc` 报类型错误 | 前端类型不匹配 | 修类型，不用 `any`/`@ts-ignore` 糊过去 |
| `vite build` 成功但界面没变 | 改的是 `bin/web`，运行时读的是 `web/` | 重新构建前端并重开应用 |
| 编译通过但启动白屏 | `web/index.html` 不存在或路径不对 | 先 `npm run build`，确认 `web/index.html` 存在 |

## 检查清单

- [ ] 前端 `npm run build` 通过（含 `tsc -b`），没有新增类型错误。
- [ ] 后端编译通过，产物是 `bin/workbuddy-lite.verify.exe`。
- [ ] 没有结束任何不是自己启动的进程。
- [ ] 报告里写清用了哪条产物路径，以及正式 exe 是否被跳过、为什么。
