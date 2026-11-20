# WorkBuddy Lite · 全流程动效设计（MotionHarness 工程）

用 MotionHarness 做的可编辑动效工程：一条 62 秒的规范片，逐章演示客户端从启动到团队协作的动效，
右上角实时标注时长与缓动。画面里的应用按 1280×662 真实 CSS 尺寸编写后整体缩放 1.4625 倍，
所以尺寸、字号、颜色与 `frontend/src/index.css` 完全同源。

## 运行

```bash
cd motion
mh open          # 打开 Studio（浏览器编辑器）
mh preview --times '[0,12,30]' --contact-sheet --output-dir .tmp/previews/check
mh render .tmp/workbuddy-motion-v1.mp4
```

## 文件

| 文件 | 作用 |
|---|---|
| `src/shell.html` | 全部界面结构（侧栏 / 顶栏 / 会话 / 右栏 / 弹窗 / 频道 / 展示板） |
| `src/style.css` | 视觉样式，token 与 `frontend/src/index.css` 一致 |
| `src/motion.js` | 贝塞尔求值、时长令牌、时间轴工具 |
| `src/scene.js` | 章节时间轴：每帧都是 `time` 的纯函数，可任意跳帧 |

## 动效原则

1. **状态可读优先。** 动效回答「正在发生什么」，不做装饰。运行中靠脉冲点，完成靠实心点。
2. **四档时长。** 90 / 140 / 200 / 320ms 覆盖全部交互，超过 320ms 只有章节转场。
3. **位移 ≤ 8px。** 桌面端密度高，长距离位移会让界面「飘」；面板开合走宽度，不做整屏滑动。
4. **只有四条曲线。** expo-out 管进入，exit 管退出，in-out 管开合与位移，standard 管颜色与按压。
5. **可降级。** `prefers-reduced-motion` 下统一 80ms 淡入，位移与缩放归零。

## 令牌

| Token | 值 | 用在哪 |
|---|---|---|
| `--dur-instant` | 90ms | 悬停、按压、颜色 |
| `--dur-fast` | 140ms | 小展开、提示文字、状态点变色 |
| `--dur-base` | 200ms | 消息与工具行插入、弹窗、toast |
| `--dur-slow` | 320ms | 右栏开合、窗口进入、章节交叉 |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | 进入、插入、展开 |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | 关闭、移出 |
| `--ease-inout` | `cubic-bezier(.65,0,.35,1)` | 面板开合、指示器位移 |
| `--ease-std` | `cubic-bezier(.2,0,0,1)` | 悬停、按压、颜色 |
| `--lift` | 4–8px | 单元素进入位移上限 |

## 全流程

| 章节 | 时间 | 动效要点 |
|---|---|---|
| 00 片头 | 0–3s | 标题上浮 10px / 480ms，交叉淡出 |
| 01 启动与空态 | 3–10s | 窗口 320ms 进入（8px + scale .995）；侧栏逐项 24ms stagger；输入框聚焦 120ms ring；发送键按下 scale .97 / 90ms；用户消息 6px / 200ms |
| 02 会话流式 | 10–18s | 思考行 140ms；段落按字流式，caret 1s 线性闪烁；列表 120ms stagger 5px；用量行 200ms |
| 03 工具调用 | 18–27s | 工具行高度 0→34 / 200ms；状态点 2s 脉冲 → 实心；diff 展开 220ms / 收起 180ms；失败行红点 + 文案；计划卡 200ms |
| 04 右栏与任务 | 27–35s | 面板宽度 0→420 / 320ms in-out；tab 指示器 200ms 滑动；进度条 800ms 匀速；阶段与代理行 200ms；宽度 420→360 可调 |
| 05 插件市场 | 35–43s | 遮罩 200ms；弹窗 180ms（scale .98 + 12px）；筛选条 24ms stagger；过滤行高度 120ms 退出；安装态 180ms；弹窗高度随内容 140ms 收缩；toast 200ms 进 / 160ms 出 |
| 06 团队频道 | 43–50s | 频道 200ms 淡入；头像 40ms stagger；消息 6px / 200ms；输入点 1.2s 循环；反应 chip scale .9→1 / 180ms |
| 07 微交互 | 50–57s | 六宫格：悬停 90ms、按下 90ms、聚焦 120ms、确认 180ms、运行 2s、展开 200ms |
| 08 动效令牌 | 57–62s | 时长条与曲线按 50ms stagger 展开 |

## 落到代码里

`frontend/src/index.css` 里加同名变量，然后把 `.srow`、`.msg`、工具行、`Dialog`、`toast` 的
`transition` 从 `all 300ms` 换成对应 token；运行中脉冲保留 `animate-pulse`。
不建议直接把本工程的场景代码搬进产品——这里是为了「看得见」而写的逐帧实现。
