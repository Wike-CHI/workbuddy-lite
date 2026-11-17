---
name: wbl-feature
description: "workbuddy-lite 的功能开发编排入口。用户在这个仓库里提出新功能、改交互、修界面问题、给插件市场/会话/工作台加能力时用它，例如「给插件市场加分类筛选」「会话列表显示模型」「右栏加个 tab」。也用于后继续做：接着上次改、只改样式、只调文案、验收没过要返工、结果改进、重新跑一遍。单纯问代码在哪、解释某个函数怎么工作，不要用这个技能。"
---

# workbuddy-lite 功能开发编排

这个仓库的改动几乎都会穿过同一条链：**确认 CLI 有没有现成能力 → 定接口 → 改界面 → 编译 → 截图验收 → 提交**。
编排的价值不是把活分给更多人，而是保证每一步的产出能被下一步直接用，并且不碰用户正在用的 exe。

## 执行模式：混合（主会话编排 + 顺序委派 + 只读验收）

| 阶段 | 执行模式 | 为什么 |
|---|---|---|
| 0–1 判定与调研 | 主会话直接做，必要时派 `wbl-scout` | 范围判定需要对仓库的整体判断，不适合外包；CLI 能力探查是只读收集，适合单次委派 |
| 2 后端 | 命名子代理 `wbl-backend` 顺序执行 | 依赖 1 的结论，且前端要等它的字段契约 |
| 3 前端 | 命名子代理 `wbl-frontend` 顺序执行 | 依赖 2 的契约 |
| 4 构建 | 主会话跑 `wbl-build` 脚本 | 命令固定，主会话执行最省一次往返 |
| 5 验收 | 子代理 `wbl-verify` 独立执行 | 生成者与验收者分离，验收结论才独立 |

不使用 `Workflow` 脚本：本运行时不提供 `Workflow` 工具，且这条链每步都要人看结果再决定下一步。
不使用常驻团队：四个角色是线性依赖，没有需要反复协商的中间态。
子代理默认后台运行；需要它的结果才能继续时，等完成通知再往下走，不要提前假设结论。

## 角色与技能

| 角色 | `subagent_type` | 模型 | 使用的技能 | 产出 |
|---|---|---|---|---|
| 编排者（主会话） | — | 会话模型 | `wbl-feature`、`wbl-build` | 范围判定、`00_brief.md`、构建、提交建议 |
| CLI 能力探查 | `wbl-scout` | sonnet | — | `01_scout_capability.md` |
| 后端 / CLI 集成 | `wbl-backend` | opus | `wbl-build` | 代码 + `02_backend_contract.md` |
| 前端 / 交互 | `wbl-frontend` | opus | `wbl-design-tokens`、`wbl-build` | 代码 + `03_frontend_notes.md` |
| 验收 | `wbl-verify` | sonnet | `wbl-visual-check`、`wbl-build` | 验收报告（编排者存成 `05_verify_report.md`） |

模型分工的理由写在各自 agent 定义的 frontmatter 注释里。编排者本身承担跨阶段计划与返工判断，
属于最高一档（fable 档）的工作，但它运行在主会话，不单独指定模型。

## 工作目录

所有中间产物放 `bin/_workspace/<slug>/`，`<slug>` 用需求的英文短名（如 `market-category-filter`）。
`bin/` 已在 `.gitignore` 里，既不污染仓库，也方便和截图放一起。
文件名固定，下游按名字找，不靠记忆：

| 文件 | 产出者 | 消费者 |
|---|---|---|
| `00_brief.md` | 编排者 | 所有 agent |
| `01_scout_capability.md` | `wbl-scout` | 后端、前端 |
| `02_backend_contract.md` | `wbl-backend` | 前端、验收 |
| `03_frontend_notes.md` | `wbl-frontend` | 验收 |
| `04_build.log` | 编排者 | 验收 |
| `05_verify_report.md` | 编排者（抄 `wbl-verify` 的返回） | 用户、返工依据 |

## 工作流程

### 0 步：判定首次 / 续做 / 只改一部分

先看 `bin/_workspace/` 里有没有同名目录，再决定走哪条路：

| 情况 | 判定 | 动作 |
|---|---|---|
| 没有目录 | 首次 | 建目录，写 `00_brief.md`，从 1 步开始 |
| 有目录 + 用户说「验收没过 / 按报告改」 | 返工 | 读 `05_verify_report.md` 的「问题」表，只派给对应实现 agent，从被退回的那一步开始 |
| 有目录 + 用户说「只改样式 / 只调文案 / 只改排序」 | 局部 | 跳过 1、2 步，直接 3 步；改完仍要 4、5 步 |
| 有目录 + 用户给了新需求 | 新轮 | 把旧目录改名成 `<slug>_<YYYYMMDD-HHMM>`，新建同名目录重来 |

`00_brief.md` 至少写清：用户原话、涉及的界面/接口、验收标准（能截图看到什么算完成）、是否允许改后端。

### 1 步：现状调研（主会话，必要时派 `wbl-scout`）

1. `grep` 现有实现：相关路由、组件、类型定义、已有字段。先证明「已经有什么」，再决定「要加什么」。
2. 涉及 codebuddy CLI 的数据（插件、市场、模型、技能、连接器、会话状态）时，派 `wbl-scout` 出一张能力表，
   存 `01_scout_capability.md`。**不要跳过这一步就动手在后端造数据。**
3. 判定改动面，写进 `00_brief.md` 末尾：
   - `纯前端`：数据已存在，只改筛选/排序/展示 → 跳过 2 步。
   - `前后端`：缺字段或缺接口 → 走 2 步。
   - `纯后端`：只修数据正确性，界面不用动 → 跳过 3 步，但 4、5 步仍要做（至少确认没有把界面弄坏）。

### 2 步：后端接口（`wbl-backend`）

派发时在 prompt 里给全：需求一句话、`01_scout_capability.md` 路径、需要前端拿到什么、允许改哪些文件。
要求它必须产出 `02_backend_contract.md`，格式是「方法 / 路径 / 入参 / 返回 JSON 形状 / 错误信息」。

契约不合格（写「返回插件列表」这种）就退回重写，不要让前端照着猜。
后端只跑编译验证（`wbl-build` 的 verify 路径），不在这里截图。

### 3 步：前端交互（`wbl-frontend`）

派发时给：`00_brief.md`、`02_backend_contract.md`（纯前端改动时说明「数据已存在，来源是 X」）、
需要新增的稳定 `id`（给截图脚本用）。要求产出 `03_frontend_notes.md`，写清改了哪些组件、
验收时怎么点到这个功能。

样式与 token 必须走 `wbl-design-tokens`；不要新增依赖；不要把排序口径丢给后端。

### 4 步：构建（主会话）

```bash
cd frontend && npm run build
bash .codebuddy/skills/wbl-build/scripts/build-verify.sh
```

输出存 `04_build.log`。两条都过才进 5 步。链接报 `LNK1104` 说明正式 exe 被占用：改用 verify exe，
**不结束进程**，并在最终报告里注明正式产物待用户关闭窗口后再出。

### 5 步：截图验收（`wbl-verify`）

派发时给：验收标准（`00_brief.md`）、契约与前端说明、要截哪几个状态、截图名。
它按 `wbl-visual-check` 跑 demo + `--shot`，用 ViewImage 看，返回验收报告。编排者把报告存成
`05_verify_report.md`。

- 结论「通过」→ 进 6 步。
- 结论「不通过」→ 按「问题」表分派返工，最多两轮；两轮仍有问题就把问题和证据一起交给用户判断。
- 缺证据（只说「看起来正常」没有截图路径）→ 退回重验。

### 6 步：提交建议（不自动执行）

1. 汇总改动：`git status --short`、`git diff --stat`。
2. 按仓库历史风格给一条提交信息：`feat(scope): ...` / `fix(scope): ...`，
   scope 用模块名（`market`、`session`、`workbench`、`ui`、`composer`）。
3. **把命令和建议交给用户确认后再执行**；不 `push`，不 `--amend`，不跳过 hooks。
4. 最终汇报：改了什么、验收结论、截图路径、提交信息、遗留问题。

## 数据传递

- 一律文件传递，路径固定（见上表）。子代理返回消息只做摘要，不作为下游唯一来源。
- 契约变更时，后端先改 `02_backend_contract.md` 并在文件顶部写「v2 + 改了什么」，
  再通知前端重读；不要口头传字段。
- 截图和构建产物留在 `bin/`，`bin/_workspace/` 在功能完成后再保留一轮，方便复盘。

## 错误处理

| 情况 | 处理 |
|---|---|
| 子代理失败一次 | 换条件重试一次（补上下文、缩小范围、换文件路径）；仍失败就记入报告并继续能做的部分 |
| 用量耗尽、鉴权过期、权限拒绝 | 不重试。打开已有产物确认进度，把缺口写进 `05_verify_report.md` 并告知用户 |
| 前后端字段对不上 | 退回后端改契约，禁止前端用假数据补齐 |
| 编译失败 | 读第一条 error，交回对应实现 agent；同类错误连续两次就停下来问用户 |
| 截图空白/全黑 | 按 `wbl-visual-check` 的排查表加 `--wait`、调 `--eval` 时序；两次仍失败判「截图不可用」 |
| 正式 exe 被占用 | 走 verify exe，不杀进程；在报告里注明 |
| 用户中途改需求 | 回到 0 步重新判定范围，旧产物改名保留，不在原文件上覆盖 |

## 测试场景

### 正常流程：插件市场按分类筛选 + 已安装排序

1. **0 步**：`bin/_workspace/market-category-filter/` 不存在 → 首次。`00_brief.md` 写验收标准：
   市场弹窗里能看到分类筛选条，选中「dev」后只剩该分类插件；已安装插件排在每个市场分组最前。
2. **1 步**：`grep` 发现 `src/catalog.cpp:293` 已把 `marketplace.json` 的 `plugins[].category` 透传到
   `/api/market/overview`，`MarketPlugin.category` 在 `frontend/src/lib/types.ts` 里已声明且可为空；
   `PluginMarket.tsx:139` 已经按 `installed` 在每个市场分组内排序。结论：**数据齐全，纯前端改动**，
   跳过 2 步；同时记下风险「部分插件 category 为空，筛选条要能处理空值」。无需派 `wbl-scout`。
3. **3 步**：派 `wbl-frontend`。产出：分类筛选条（带「全部」）、空分类归入「未分类」、
   分组内已安装优先保持不变；新增 `id="market-category-all"`、`market-category-<name>`。
   `03_frontend_notes.md` 写明验收时点这两处。
4. **4 步**：`npm run build` 通过（含 `tsc -b`）；`build-verify.sh` 产出 verify exe。
5. **5 步**：派 `wbl-verify` 截 `bin/visual/market-category-light.png` 与 `market-category-dark.png`：
   `--eval "setTimeout(function(){window.__wbl.openMarket()},400);setTimeout(function(){document.getElementById('market-category-dev')?.click()},1200)"`，
   浅色再切 `.dark` 补一张。ViewImage 看到筛选条出现在 sticky 头部下方、列表只剩 dev 分类、无重叠。
6. **6 步**：建议提交 `feat(market): filter plugins by category`，等用户确认。

### 错误流程：正式 exe 正被占用

1. **4 步** 跑 `build.bat` 报 `LNK1104: 无法打开文件“bin\workbuddy-lite.exe”`。
2. 编排者判断是实例占用，**不结束进程**，改用 `build-verify.sh` 编出 verify exe，`04_build.log` 记下这件事。
3. **5 步** 截图第一次只拿到应用背景：`--wait` 从 2400 提到 4000，并把打开弹窗的 `setTimeout` 加到 900ms。
4. 第二次截图正常；`05_verify_report.md` 的「证据」里注明「正式产物待用户关闭窗口后重编」，
   结论写「有条件通过」。用户关闭窗口后再补一次正式构建。

## 完成定义

- [ ] `00_brief.md` 的范围判定与实际改动一致（纯前端没偷偷改后端，反之亦然）。
- [ ] 涉及 CLI 数据时，`01_scout_capability.md` 明确写了「复用 / 新增」及证据。
- [ ] 后端改动有 `02_backend_contract.md`，字段能被前端直接抄。
- [ ] `npm run build` 与后端编译都通过；正式 exe 是否跳过有说明。
- [ ] 至少一张截图，ViewImage 看过，`05_verify_report.md` 有结论和证据。
- [ ] 提交信息符合 `feat(scope): ...` 风格，且经过用户确认才执行。
