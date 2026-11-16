# WorkBuddy Lite · 界面设计系统与重构记录

面向 Windows 桌面端的 Coding Agent 客户端。目标不是「更好看的聊天框」，而是让**任务状态、执行层级、代码与文件操作**在一屏内可读、可操作、可追。

---

## 1. 设计原则

1. **内容优先于容器。** 去掉装饰性卡片：消息正文、工具调用、计划都以排版和留白建立层级，只有真正可交互的块（composer、弹窗、diff）才有边框。
2. **一个强调色。** 只有交互与运行中状态使用 iris（`--accent`）；成功 / 警告 / 失败走语义色，不再用彩色徽标堆信息。
3. **字号有下限。** 界面最小 10.5px（仅时间戳/角标），正文 13.5px，代码 12–12.5px。开发者长时间盯屏，10px 正文不再出现。
4. **状态靠形状与位置。** 运行中 = 脉冲圆点；完成 = 实心点；失败 = 红点 + 文本；不用彩色胶囊表达状态。
5. **键盘优先。** `Ctrl N / Ctrl K / Ctrl B / ↑↓ / Enter / Esc` 覆盖高频路径，输入区与列表都可用键盘走完。

---

## 2. Design Tokens

定义在 `frontend/src/index.css`（`@theme inline` 暴露给 Tailwind，`.dark` 覆盖同名变量）。

| 分类 | Token | Light | Dark |
|---|---|---|---|
| Surface | `--canvas` | `#fbfbfa` | `#131316` |
| | `--sidebar` | `#f5f5f2` | `#17171a` |
| | `--surface` | `#ffffff` | `#1c1c20` |
| | `--surface-2` | `#f4f4f1` | `#202024` |
| | `--surface-3` | `#eceae5` | `#2a2a2f` |
| Ink | `--ink` | `#1b1b1f` | `#e9e9ec` |
| | `--ink-2` | `#55555e` | `#b0b0ba` |
| | `--ink-3` | `#8a8a94` | `#83838d` |
| | `--ink-4` | `#a9a9b1` | `#5f5f68` |
| Line | `--hairline` | `#e7e6e1` | `#2a2a30` |
| Accent | `--accent` | `#5b5bd6` | `#7c7cf0` |
| State | `--ok` / `--warn` / `--err` | `#16794c` / `#9a6700` / `#c0392b` | `#4ac48a` / `#d9a441` / `#f27c72` |

- **Radius**：`sm 4 / md 6 / lg 8 / xl 12`。卡片统一 8px，composer 12px，按钮 6px。
- **Type**：正文 13.5/1.75；UI 12.5；meta 10.5–11；mono 11–12.5。
- **Elevation**：只有 popover/toast 用 `--shadow-pop`；主界面靠 hairline 与 surface 分层，没有卡片阴影。
- **Motion**：hover/展开 120–160ms；脉冲点 2s；不做位移动画。

---

## 3. 抽象层级

| 层级 | 内容 | 位置 |
|---|---|---|
| Token | 颜色、圆角、阴影、字体、动效时长 | `src/index.css` |
| Primitive | Button / Input / Select / Dialog / Popover / Tooltip / Badge | `src/components/ui/*` |
| Composite | 侧栏会话行、工具调用行、计划清单、工作流卡片、面板 tab | `src/components/{chat,workbench}/*` |
| Business | Sidebar、Topbar、ChatThread、Composer、RightPanel、WorkspaceDialog | `src/components/*` |

约束：业务组件不直接写死颜色，一律走 token（`bg-surface-2`、`text-ink-3`、`border-border`）。本轮已把 chat / sidebar / topbar / composer / workbench 中的硬编码 hex 清掉。

---

## 4. Component Inventory

**Navigation**
`Sidebar`（工作空间切换器、新会话、搜索、时间分组、其他项目折叠、状态页脚）
`Topbar`（标题、工作空间、演示标记、上下文、积分、主题、工作台开关）
`RightPanel` 顶部 tab（文件 / 变更 / 计划 / 待办 / Git / 任务 / 浏览器）

**Content**
`ChatThread`（视口 + 空态）、`MessageItem`（用户块 / 助手 prose / reasoning）、`MarkdownPart`、`CodeHeader`、`ToolPart`（工具行 + diff）、`PlanPart`、`PermissionPart`、`UsagePart`、`ErrorPart`
`FilePreview` / `DocxViewer` / `XlsxViewer` / `PptxViewer` / `ImageViewer`

**Input**
`Composer`（输入、模型、权限模式、图片、交互回答、技能/连接器、发送/停止）
`WorkspaceDialog`（当前空间、快速切换、编辑表单、空间列表）

**Feedback**
`Toaster`（含 `confirmToast` 二次确认）、`Agent 未就绪` 横条、工具状态点、运行中脉冲、`Progress` 条

**Overlay**
`Dialog`（工作空间 / 用量 / 市场 / 模板库 / 控件编辑器）、`Popover`（详情 / 分享）、`Tooltip`、`Command palette`（`/`、`@`）

**Agent Execution**
`TasksPanel`（工作流卡片、子智能体卡片、全部/进行中过滤）
`WorkflowCard`（进度、阶段、代理、输出、重跑）
`agentRuns` / `workflowRuns`（从 ACP 事件派生，不新增状态存储）

---

## 5. 关键组件职责

| 组件 | 负责 | 不负责 |
|---|---|---|
| `Sidebar` | 工作空间身份、会话导航、搜索/键盘、子代理与工作流概览 | 会话内容、执行详情 |
| `Topbar` | 当前会话上下文、成本、主题、右栏开关 | 模型/权限切换（已下放到 composer） |
| `ChatThread` | 滚动容器、空态引导 | 消息渲染细节 |
| `MessageItem` | 角色区分、部件编排、复制动作 | 具体部件内部样式 |
| `ToolPart` | 单条工具调用的状态、参数、diff、结果 | 跨工具聚合（在 TasksPanel） |
| `Composer` | 输入、附件、模型/模式、发送/停止、palette | 会话历史、执行状态（只读 store） |
| `RightPanel` | 面板壳、tab 切换、宽度、详情/分享入口 | 各面板数据加载 |
| `TasksPanel` | 工作流与子代理的运行视图、阶段下钻、重跑入口 | 发起对话（通过 store 的 `send`） |
| `WorkflowCard` | 单个 run 的进度、阶段、代理、错误 | 解析 ACP（在 `workflowRuns`） |

---

## 6. 本次重构的关键决策

1. **模型与权限模式从顶栏移进 Composer。** 顶栏回到「我在哪、花了多少」；输入区承担「这一次怎么跑」，与 Cursor / Claude Code 的心智一致。
2. **工具调用从卡片改为行。** 一层表面 + 状态点 + 折叠箭头；展开后才出现参数与 diff。长对话不再被十几张边框卡片切碎。
3. **工作流改为「进度 + 阶段 + 代理」三层。** 阶段是可点的筛选器，代理论文（token、错误、回传输出）在阶段下钻里看；失败就地重跑（toast 二次确认）。
4. **用户消息去气泡。** 左侧浅色块 + 「你」标签，与助手正文形成上下关系，而不是聊天气泡的左右对话感。
5. **空态去营销。** 工作空间名 + 新会话 + 三条可直接执行的命令 + 键盘提示，没有 Sparkles 和套话。
6. **深色模式补齐。** 以 `.dark` class 切换，`color-scheme` 同步，代码高亮单独覆盖；主题选择持久化，默认跟随系统。
7. **不引入新依赖。** 全部使用现有 React 19 / Tailwind 4 / Radix / assistant-ui / Zustand。

---

## 7. 验证

截图见 `docs/ui/`：

| 状态 | 文件 |
|---|---|
| 改造前（聊天 + 侧栏 + 顶栏） | `before-chat.png` |
| 改造后 · 浅色 | `after-chat-light.png` |
| 改造后 · 深色 | `after-chat-dark.png` |
| 改造后 · 工作流 / 任务面板 | `after-workbench.png` |
| 改造后 · 空会话 | `after-empty.png` |

命令：

```bat
cd frontend
npm run build   :: tsc -b + vite build，通过
npm run lint    :: oxlint，0 error（21 条既有 warning）
```

功能回归（手工验证过的路径）：

- [x] 会话列表、搜索、↑↓/Enter、重命名、删除（toast 确认）
- [x] 切换工作空间、新建/编辑/删除工作空间、多文件夹
- [x] 发送消息、停止、附件、`/` 与 `@` palette
- [x] 模型切换、权限模式切换（已移入 composer）
- [x] 工具调用展开/折叠、diff、文件预览
- [x] 右栏：文件树、变更、计划、待办、Git、任务、浏览器、详情、分享
- [x] 工作流：进度、阶段下钻、失败重跑（toast 确认）
- [x] 深浅色切换与持久化
- [x] 1280px 主窗口 + 右栏展开时不挤压顶栏

---

## 8. 已知问题 / 下一步

- 右栏在 <340px 宽度时 tab 需要横向滚动（已加 `scrollbar-none`，但可考虑溢出菜单）。
- 用户消息的「你」标签在连续多条用户消息时会显得重复，可改为只在会话首条显示。
- 工具行与 diff 的嵌套仍有一层内边距，长 diff 场景可考虑全宽抽屉。
- 工作流的「阶段→代理输出」依赖 CLI 回传 `workflowAgentKey` 文本事件；没有时只显示状态与 token。
