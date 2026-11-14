# Android P0：Termux 安装、登录与 ACP 验证

对应 [Android 实施计划 #2](https://github.com/Wike-CHI/workbuddy-lite/issues/2)。本次交付是首批 P0 工具，尚未包含 React Native APK、RUN_COMMAND 原生模块或后台常驻服务。

目标运行方式为 **React Native → Termux Node bridge → CodeBuddy CLI**。这些脚本先验证最底层的 CLI/ACP 能否在手机本地工作，后续 bridge 可沿用协议经验，但不将冒烟客户端直接视为生产实现。

## 1. 安装环境

使用标准包名 `com.termux` 的 Termux，建议从 [Termux 官方入口](https://termux.dev/) 选择来源。首批真机目标为 Android 10+ ARM64。将本仓库克隆到 Termux HOME 内，不放在共享存储目录；CLI 的可执行依赖与项目需要正常的 Unix 文件权限。

```bash
pkg update
pkg install -y git nodejs-lts
git clone https://github.com/Wike-CHI/workbuddy-lite.git
cd workbuddy-lite
```

PR 合并前，需要切换到本 PR 的分支才能获取脚本：

```bash
git switch feat/android-p0-termux
```

脚本使用 Node 22+ 内置 API，无需安装本项目的 Web 前端依赖。CodeBuddy 自身的 Node 要求按所选版本的 npm `engines` 校验；Node 22 是探针基线，不能代表所有 CLI 版本都适配。

先查看候选版本及其要求，再用**明确版本号**安装，避免后续自动更新改变验证条件：

```bash
npm view @tencent-ai/codebuddy-code version engines --json
# 将下行的 x.y.z 替换为上述返回的精确版本。
bash scripts/android/bootstrap.sh x.y.z
```

bootstrap 会补齐缺失依赖，检查请求版本的 engines，并执行 `npm install --engine-strict`。同版本已安装时不会重新安装。它不会更改用户凭据、配置 `allow-external-apps` 或升级 CLI 到 latest。安装失败应保留本机错误现场，先定位原生依赖/Bionic 问题，不使用关闭鉴权等方式绕过。

## 2. 终端登录

在 Termux 中运行：

```bash
codebuddy
```

按账户选择中国站、国际站或企业站，并完成 CLI 提供的官方浏览器授权流程。若 CLI 显示 URL 但未自动打开，在手机浏览器中打开该 URL，按实际界面返回或输入授权码；不预设某种回调方式一定受支持。登录后退出交互 CLI，再运行下面的诊断。

如需重新登录，使用当前 CLI 提供的账户菜单/`/login`；不要删除整个 `~/.codebuddy` 目录。首次浏览器登录、取消、过期、重新登录都要在兼容矩阵分别记录。CLI 可能使用已有 API Key，因此 ACP 会话可用本身不能证明浏览器登录已通过。

## 3. 环境诊断

```bash
node scripts/android/doctor.mjs --out doctor-phone-01.json
```

退出码 0 表示 Termux/ARM64、Node 22+、npm、Git、CLI 及 `--serve` 标志检查通过；1 表示有缺项；2 表示参数或报告写入失败。`login` 与 `runCommandPermission` 保持 `not_verified`，不会根据文件存在就推断已授权。

`externalApps` 只检查配置文件中的声明，不代表 Android 已授予权限。未来 RN 原生模块还需要 `com.termux.permission.RUN_COMMAND`、Android 设置授权以及 Termux 的 `allow-external-apps=true`；此 PR 不会替用户更改这些设置。

## 4. 协议冒烟

```bash
node scripts/android/smoke.mjs --out smoke-protocol-phone-01.json
```

探针在新的私有临时目录启动独立的 `codebuddy --serve`，仅监听 `127.0.0.1`，检查 health、ACP connect/initialize、session/new，以及**重新建立 ACP 连接后的 session/load**。不发送模型 prompt，不代表文件工具或后台恢复通过。CLI 的会话创建是否产生服务端行为由其自身实现决定。

CLI 默认鉴权保持启用。若现有配置要求 gateway Bearer token，可在本机环境中提供 `WBL_GATEWAY_TOKEN`，不要把值写在报告、URL 或命令行参数中。401/403 是待定位的鉴权问题，脚本不会自动设置 `CODEBUDDY_GATEWAY_AUTH=none` 或关闭请求校验。

## 5. 真实任务与取消

以下操作会调用模型并可能消耗账户额度，在可交互的 Termux 终端运行：

```bash
node scripts/android/smoke.mjs --task --cancel-check --out smoke-task-phone-01.json
```

- 第一轮创建指定内容的 `probe.txt`，随后重连并加载会话。
- 第二轮读取和修改文件，通过 shell 中的 Node 命令生成检查产物；探针核对实际文件内容，并要求观察到 ACP `execute` 工具事件。
- 取消检查先发起可持续生成的任务，等待一秒后发送 `session/cancel`，必须收到 `stopReason=cancelled` 才算通过。若任务提前完成，报告 `CANCEL_NOT_OBSERVED`，不能作为取消成功证据。
- 权限请求显示工具标题/输入和选项序号，由你明确选择；不交互时返回取消，不默认允许。展示的工具信息由 Agent 提供，不是系统对命令效果的保证。
- permission 请求在 POST/SSE 双通道出现时只询问一次。RPC 超时不会自动重发 prompt。

退出码 0 只代表**请求执行的检查**通过，1 表示探针失败，2 表示参数/报告问题。报告里的 `not_requested` / `not_verified` 不能作为通过项。协议请求和 prompt 分别有超时；Ctrl+C/SIGTERM 会触发连接和子进程清理。

探针只终止自己启动的进程组，不使用 `pkill codebuddy`。临时工作目录位置只在本地 stderr 显示，保留小型文件便于人工检查；确认后可自行删除。CLI 可能仍按自己的策略在私有目录保留会话元数据。

报告不存储原始模型文本、认证 URL、令牌、账户信息、sessionId 或工作目录路径；仅记录版本、检查状态和少量计数。输出文件以 0600 权限独占创建，拒绝覆盖已有文件。请使用不同文件名保存新一轮结果。权限详情仅显示在本机交互终端；不要把整段终端录屏当作脱敏报告上传。

## 6. 真机兼容矩阵与 P0 验收

当前状态：**尚无真机结果**。下面每行都需要实际运行后填写，不能用本机 mock 测试代替。

| 设备/版本 | Termux 来源/版本 | Node/npm/CLI | 浏览器登录/重新登录 | health/ACP | 文件/shell/权限 | 取消/续接 | 证据 |
|---|---|---|---|---|---|---|---|
| 用户 ARM64 手机：待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待上传 |
| 另一 Android 版本设备：待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待上传 |

手工补充清单：

- [ ] 记录 Android 版本、Termux 安装来源和版本、doctor 报告。
- [ ] 首次浏览器授权、取消、过期和重新登录真实可用。
- [ ] `--task` 报告通过，并人工检查工具执行记录与产物。
- [ ] 分别测试允许/拒绝权限，不出现静默等待。
- [ ] `--cancel-check` 报告通过，重新打开 CLI 可继续会话。
- [ ] 手机重启/CLI 进程重启后的历史续接另行验证（探针只覆盖连接重建）。
- [ ] RN 模块落地后验证 RUN_COMMAND 授权与 PendingIntent 返回。
- [ ] RN/bridge 落地后验证切后台、锁屏、断网、系统回收和恢复。

出现 `Method not found`、登录失败、原生依赖失败或权限流程不兼容时，记录 CLI 精确版本与失败阶段，保持该项待验证并阻塞相应真实集成。

## 开发验证

```bash
bash -n scripts/android/bootstrap.sh
node --test scripts/android/tests/*.test.mjs
```

离线测试通过本地 HTTP fixture 覆盖 SSE 跨字节中文、CRLF/多行数据、JSON、响应大小限制、401、RPC 超时清理、订阅先返回、权限重复请求、两轮任务、取消和进程清理。fixture 模拟文件与工具事件，仅验证探针本身，不证明真实 CLI 已在 Android 跑通。

## 参考

- [CodeBuddy 官方安装](https://www.workbuddy.ai/docs/cli/installation)
- [CLI 命令参考](https://intl.cloud.tencent.com/document/product/1316/84467)
- [ACP 集成](https://intl.cloud.tencent.com/document/product/1316/84434)
- [Termux RUN_COMMAND Intent](https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent)
