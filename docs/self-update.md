# 自更新：换掉 exe 并接着上次的会话

这是一个「自己改自己」的窄流程：**编译到 next → 独立 updater 等旧进程退出 → 原子替换 → 带参数重启**。
它不是安装器，不处理卸载、回滚包、签名、多用户或跨版本迁移。

## 适用场景

改完本仓库的 C++/前端后，想让正在运行的 WorkBuddy Lite 用上新版本，同时保持当前会话、模型档位、
频道和右栏状态。用户不必手动关窗口再双击 exe。

## Agent 的完整流程

```bash
# 1. 改代码
# 2. 编前端（运行时优先读仓库根的 web/）
cd frontend && npm run build

# 3. 编到 next，不要覆盖正在运行的 exe
#    做法：把 build.bat / build-verify.sh 的产物复制成 next
cp bin/workbuddy-lite.verify.exe bin/workbuddy-lite.next.exe
cmd //c build-updater.bat        # 首次或 updater 有改动时；build.bat 也会调用它

# 4. 调 restart（Body 可省略；默认取 exe 同级的 workbuddy-lite.next.exe）
curl -X POST http://127.0.0.1:<port>/api/app/restart -H "Content-Type: application/json" -d "{}"

# 5. 旧进程退出，updater 替换并启动新进程；前端按 ui-state 回到原会话/频道/工作台
```

端口从 `<WORKBUDDY_LITE_DATA>\port.txt` 读取（默认数据目录是 `%LOCALAPPDATA%\WorkBuddyLite`）。

也可以在界面上点顶栏的「更新」：只有 `workbuddy-lite.next.exe` 存在时按钮才出现。确认后显示重启遮罩，
`window.__wbl.applyUpdate()` 是不弹确认框的自动化入口。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/app/update` | `{updateReady, next, updaterReady, restarting, target}`；`updateReady` 只取决于 next 是否存在 |
| POST | `/api/app/restart` | 入参可选 `{next?: "相对路径或绝对路径"}`，默认 exe 同级的 `workbuddy-lite.next.exe`；文件名必须是 `workbuddy-lite.next.exe`，否则 400；文件不存在返回 `409`；返回 `202 {ok:true,pid,next,updater}` |
| GET | `/api/app/ui` | 读取上一进程落下的 `{activeSessionId, activeChannelId, chat, workbench}` |
| POST | `/api/app/ui` | 合并写入上述字段；`activeSessionId` 同时写回 `sessions.json` 的 `lastSessionId` |

restart 依次做四件事：

1. `saveStore()`，确保会话事件、`lastSessionId`、会话 `config` 已落盘；
2. 把 `bin/workbuddy-updater.exe` 复制到 `%TEMP%\workbuddy-updater-<pid>-<tick>.exe`；
3. 用 `DETACHED_PROCESS` 启动 updater，把当前 PID、next、target、超时和**原始命令行参数**传过去；
4. 返回 202，600ms 后通过 main.cpp 注入的退出钩子 `PostMessage(WM_CLOSE)` 走正常关窗路径：
   WebView2 控制器关闭、`backend.stop()` 保存 store 并 `taskkill /T` 结束 `codebuddy --serve` 子进程。

## updater

构建产物：`bin/workbuddy-updater.exe`（`build-updater.bat`，`build.bat` 会顺带调用）。

```text
workbuddy-updater.exe --pid <oldPid> --next <nextExe> --target <targetExe> --timeout <sec> [--] <app args...>
```

行为与退出码：

| 步骤 | 失败时 |
|---|---|
| 等旧 PID 退出（`WaitForSingleObject`） | 超时写日志，退出码 `2`，不动任何文件 |
| target 重命名为 `<target>.old.<unix秒>`（重试 20 × 250ms） | 退出码 `4`，target 保持原样 |
| next 移到 target（重试 30 × 250ms） | 把 old 移回 target 后退出码 `5` |
| `CreateProcess` 启新进程（继承 updater 的 cwd 和参数） | 退出码 `6`，新文件保留、old 保留供手动恢复 |
| 删除 `.old` | 删不掉只记日志，下次 updater 启动时清理 `<target>.old.*` |

日志：`<target 所在目录>\updater.log`，一行一次操作，包含 PID、路径、错误码与回滚结果。
updater 自己从 `%TEMP%` 副本运行，避免替换 `bin` 时把自己锁住。

## 状态恢复

WebView2 的 user data 目录是 `data\WebView2-<pid>`（多窗口隔离），所以 localStorage 活不过重启。
需要跨进程保留的状态由 `frontend/src/lib/uiState.ts` 合并后写到后端 `ui-state.json`：

| 状态 | 来源 | 恢复方式 |
|---|---|---|
| 当前会话 | `chat.loadSession` / `newSession` | `sessions.json.lastSessionId` → bootstrap → `loadSession`；会话不在列表时回空态并 toast |
| 模型 / 推理档位 / 权限模式 / config | `persistPrefs` | 启动时先 `restoreUiState()` 写入 store，再 bootstrap；后端另把模型写进 `settings.json.lastModel` |
| 当前频道 | `team.openChannel` / `closeChannel` | `loadState()` 后按 `activeChannelId` 打开；频道不存在时 toast |
| 右栏开合 / 宽度 / tab | `workbench.persist` | `restoreUiState()` 直接写回 store |
| ACP 上下文 | `sessions.json.acpSessionId` | 重启后第一次发消息时 `acpSessionFor()` 调 `session/load`，不需要用户重开会话 |

## 单实例与端口

当前实现没有启动互斥量：每个实例用 `bind_to_any_port` 拿空闲端口，WebView2 数据目录按 PID 隔离，
所以新旧进程不会抢 mutex/端口。updater 仍然会等旧 PID 完全退出后才替换，避免 exe 被占用。
`data\browser-profile` 是两个窗口共享的，因此也必须等旧进程退出后再启动新进程。

## 测试

```bash
node scripts/self-update-check.mjs
```

全部在 `%TEMP%` 下用 verify exe 的副本跑，不碰正在使用的 `bin/workbuddy-lite.exe`：

- 正常替换：旧 PID 退出（0）、新 PID 不同、`/api/models` 200、`lastSessionId`/频道/模型/工作台状态恢复、日志有替换记录；
- next 缺失：409，主进程继续运行、PID 不变；
- updater 等待超时：退出码 2，target/next 都不动；
- updater 独立替换：target 内容等于 next；
- 替换失败回滚：锁住 next 让 `MoveFileEx` 失败，退出码 5，target 内容不变。

界面证据（`bin/visual/`）：

| 文件 | 场景 |
|---|---|
| `self-update-dialog.png` | 顶栏「更新」+ 确认弹窗 |
| `self-update-overlay.png` | 重启遮罩（`__wbl.previewRestartOverlay(true)`） |
| `self-update-restored-channel.png` | 预置 `ui-state.json` 后启动，直接回到「项目 Falcon」频道并展开右栏 |
| `regression/*.png` | `node scripts/visual-check.mjs --exe bin/workbuddy-lite.verify.exe --out bin/visual/regression` |

## 已知边界

- 更新只换主 exe；`workbuddy-updater.exe` 自身要更新时仍需重新构建并手动替换（它从 %TEMP% 运行，不受影响）。
- 正在进行的一轮回答会被中断，未落盘的流式内容会丢，已落盘的会话事件不受影响。
- 替换成功后 `web/` 不会自动重新分发；源码树运行时直接读仓库 `web/`，分发包需要重新 `xcopy web bin\web`。
- 回滚只在「next 移不进去」时发生；新 exe 能替换但启动即崩溃时，旧文件以 `.old.<ts>` 留在 bin 目录，需要手动恢复。
