# React Native Android 开发预览

对应 #2，基于 P0 PR #3。当前提供 React Native 0.88.1 原生安卓界面、Kotlin Termux 集成、本机 Node bridge 与 SQLite 会话快照。真实设备上的 CodeBuddy/Termux 兼容性仍需按 [P0 清单](android-p0.md) 验收。

## 运行结构

手机 APK 通过显式 RUN_COMMAND Intent 启动 Termux 中的固定程序。安装与登录在可见终端完成；启动、停止、doctor 通过 one-shot PendingIntent 返回结果。bridge 的随机配对令牌仅通过私有回调交付，使用 Android Keystore AES-GCM 加密持久化；HTTP 请求只连接 `127.0.0.1`，使用 Bearer token 验证。

bridge 与 CLI 分别监听随机本地端口。CLI 保持自身鉴权与请求校验；如配置要求 gateway token，在 Termux 本机环境设置 `WBL_GATEWAY_TOKEN`。启动失败时不会自动关闭校验，也不会自动改账户配置。

会话快照与接受过的任务编号存储在 Termux 私有目录 `~/.local/share/workbuddy-lite-android/sessions.sqlite`。模型流式文本合并后每 200ms 保存快照；任务接收和完成时立即保存。内存事件队列有 epoch/seq 游标，过期或服务重启时客户端读取快照。系统强杀可能丢失最后一个保存窗口的 token；运行中状态恢复为中断，不自动重发 prompt。

## 手机首次配置

1. 安装标准 `com.termux` 包的 Termux 并打开一次。在 Termux 中安装 Git、Node 22.13+（推荐当前 LTS），克隆本分支到 HOME 下：

   ```bash
   pkg update
   pkg install -y git nodejs-lts
   git clone -b feat/android-rn-foundation https://github.com/Wike-CHI/workbuddy-lite.git
   ```

   已克隆时在原仓库执行 `git fetch origin`，再切换本分支。此版本默认工作区为 `~/WorkBuddy/mobile`。

2. 在 `~/.termux/termux.properties` 设置 `allow-external-apps=true`，保留文件中其他配置。Termux 的配置和系统授权需要用户在设备上完成，APK 不会越过系统权限修改另一个 App 的私有文件。

3. 安装 CI 生成的 ARM64 预览 APK。在“运行环境”点“打开权限设置”，授予本 App “在 Termux 环境运行命令”的附加权限。若前台终端未弹出，手动打开 Termux 或点击其通知。

4. 填写 Termux 中的仓库绝对路径和要安装的 CodeBuddy 精确版本。版本先在 Termux 中用 `npm view @tencent-ai/codebuddy-code version engines --json` 核实。点击“安装 CLI”，在终端等待完成；点击“登录账户”，完成官方浏览器授权并退出该交互会话后返回。

5. 点击“启动并安全配对”。等待 CLI 就绪，再进入“Agent 会话”创建会话、发送任务，按权限卡片选择允许或拒绝。服务已启动后才登录的，先停止服务再重新启动，以重新检查 CLI 状态。

“查看界面演示”使用本地示例数据，不会启动 CLI 或执行任务。初次版本的 `RUN_COMMAND`、私有 PendingIntent、Keystore 和浏览器回调均需真机验收；编译成功不能代替设备测试。

## 构建与检查

```bash
cd apps/mobile
npm ci
npm run typecheck
npm run lint
npm test -- --runInBand
cd android
./gradlew testReleaseUnitTest assembleRelease -PreactNativeArchitectures=arm64-v8a
```

此版本 compile 37 / target 36；SDK Manager 的平台包名称为 `platforms;android-37.0`。需要 JDK 17、Android SDK 37.0 / Build Tools 37 和 NDK 27.1。`release` 预览包内嵌 JS，不依赖 Metro，当前使用模板公开 debug keystore 签名，仅供开发验收，不作为正式发布签名。CI 将产物上传为 `workbuddy-mobile-arm64-preview` artifact。

开发调试可用 `npm start` 和 `npm run android`；手机通过 USB `adb reverse tcp:8081 tcp:8081` 连接 Metro，明文网络配置仅放行 localhost/127.0.0.1，不为任意局域网域名放行。

## 已提供的能力与边界

| 能力 | 当前实现 |
|---|---|
| 环境引导 | 检测 Termux、附加权限、安装版本与仓库路径配置 |
| 登录 | 唤起官方 CLI 的可见终端流程；不复制 OAuth 凭据 |
| 启动/停止 | 仅管理 bridge 创建的 CLI 进程组；独占运行锁与随机配对令牌 |
| 聊天 | 文本流、思考、工具状态、权限选择、取消、模型切换、积分 |
| 任务重试 | 同一次输入在网络结果不明时复用 requestId；bridge 持久化最近 100 个已接收 ID |
| 历史 | SQLite 快照；CLI 重载成功后续接；重载失败返回错误，不伪造恢复 |
| 文件范围 | 此版本固定 Termux HOME 工作目录；CLI 自身的文件工具仍受其权限策略控制，不把 cwd 宣称为沙箱 |
| 富内容 | 当前文本原样显示；Markdown 富渲染、diff、图片附件、文件预览和多工作区待后续补齐 |
| 后台 | 前端进入后台后停止轮询；Termux 进程仍可能被 Android 回收，尚无保活承诺 |

“已连接”仅表示 ACP 初始化可用，实际账户权限仍由新建会话/发送任务确认。不同 CLI 版本可能缺少 session/load 或模型配置接口；错误会直接呈现，不会静默换成假会话。

停止服务后清除 APK 本地配对信息。若系统强杀导致状态文件或锁残留，启动器只在确认记录的 PID 已不存在时清理锁；若 PID 仍存在但服务无响应，应先在 Termux 排查，避免误杀其他进程。

## 验收证据

自动检查涵盖 P0 协议探针、bridge 鉴权/Origin、任务去重、并发槽、权限作用域、重启中断、续接重放抑制、积分增量、RN 登录入口与演示隔离；Kotlin 单测覆盖命令白名单、参数边界与路径遍历。

待真机补齐：ARM64 安装、RUN_COMMAND 结果交付、Keystore 重启解密、官方登录、实际文件工具、锁屏/后台回收及任务恢复。未经设备验证，不将此版本标为生产可用。

参考：[React Native 原生工程](https://reactnative.dev/docs/getting-started-without-a-framework)、[Termux RUN_COMMAND](https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent)。
