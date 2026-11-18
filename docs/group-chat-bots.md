# 群聊 bot / 多 bot 群聊 · 设计调研与 v1 方案

> 调研对象：本机 codebuddy CLI `2.184.0`（`E:/Users/Administrator/AppData/Roaming/npm/node_modules/@tencent-ai/codebuddy-code`）
> 本轮只做调研与设计，未改 `src/`、`frontend/`，未提交。
> 所有结论都标了证据；标「推断」的地方没有实测，实现前必须复核。

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| CodeBuddy 里「群聊 bot」是什么 | 是一套叫 **AI 同事 / 频道（channel）** 的独立产品面：一个频道里至少 2 个、默认上限 12 个 AI 同事（可配），各自有头像、名字、职责说明、模型、系统提示词，用户在频道里 `@` 谁谁接手，成员之间可以接力，另有共享任务板 |
| 这套能力在哪一层 | **不在 ACP 里**。频道是 CLI 内置的 HTTP 服务 `agent-home`（`/api/v1/agent-home/*` + `~/.codebuddy/agent-home/`），web-ui 只是它的一个客户端 |
| ACP 里有什么 | 另一套东西：**Agent Teams**（`codebuddy.ai/teamUpdate` + `codebuddy.ai/memberEvent`），是「一个会话内临时组的队」，成员事件走主会话的 ACP 流 |
| 壳里能直接复用什么 | `codebuddy --serve` 已经在跑（`src/agent_host.cpp:119`），`agent-home` 的 HTTP 接口就在同一个 baseUrl 上，**已实测可读**；`Backend::agentGet()`（`src/backend.cpp:1350`）已经是对它的通用 GET 代理 |
| 壳里必须自己做什么 | 频道视图（左栏频道列表 + 群聊消息流 + `@` 选人 + 发送）、事件转发（SSE → 长轮询）、`@` 与现有「连接器」palette 的冲突处理 |
| 不能做什么 | 自建 bot 名册/消息库、自己实现轮次调度、自己伪造 `memberEvent`、为每个 bot 起一个独立 CLI 进程 |

一句话：**「群聊」这件事 CLI 已经做完了，壳只需要做它的第四个客户端**；壳不要另造一套群聊数据模型。

---

## 1. CodeBuddy 现有设计

### 1.1 先分清三个都叫「channel / bot」的东西

调研时最容易混的三个概念，混了会做错数据源：

| 概念 | 位置 | 是什么 | 对本需求 |
|---|---|---|---|
| **agent-home 频道**（`群聊`） | `~/.codebuddy/agent-home/`、`/api/v1/agent-home` | 用户 + 多个 AI 同事的群聊，持久化，有 `@`、任务板、组长 | **就是用户说的「群聊 bot」** |
| **ACP Agent Teams**（`团队`） | 会话内，`_meta['codebuddy.ai/teamUpdate']` | 模型自己组的临时队，成员是 subagent，无独立名册 | 是「一个会话里挂多个 bot」的另一条路，v2 |
| **外部 IM 频道**（企微/微信机器人） | `/api/v1/channels/*`、`channel.*` i18n | 把企微/微信消息接进某个会话 | 与本次无关，别复用这套命名 |

证据：`assets/use-i18n-Bg8iRDge.js` 里 `channel.*`（企微机器人、`channel.wecom`、`channel.wechat`）与 `agentHome.channel.*`（群聊、成员、组长）是两组互不相干的 key。

### 1.2 界面长什么样

web-ui 是纯 SPA，本地打开需要登录态；**没有启动它做截图**（见 §8 说明）。下面的布局是从编译产物里的 CSS 与 JSX 结构反推的，数值是真实值，可直接照抄。

#### 频道视图（整屏覆盖在主内容区上）

```
┌───────────────────────────────────────────────────────────────┐
│ ←  项目 Falcon            4/12 成员  [组长]      [看板] [资料] │  header  min-h, padding 10/14
├───────────────────────────────────────────────────────────────┤
│                    今天 14:02                                  │  系统事件：居中 12px text-ink-3
│  (头像)  ┌──────────────────────────────┐                      │
│   22px   │ 评审                          │  ← 名字 11px ink-3   │
│          │ 我先看接口，安全那块归你       │  ← 气泡 bg-surface-2 │
│          │  @后端  你那边先出 stub        │  ← @ chip 内联       │
│          └──────────────────────────────┘                      │
│          ┌──────────────────────────────┐                      │
│          │ 收到，15 分钟后给初版          │                      │
│          └──────────────────────────────┘                      │
│                                    ┌───────────────────────┐   │
│                                    │ 先按上周的方案走        │ → │  用户气泡 bg-surface-3
│                                    └───────────────────────┘   │      右对齐
│  ● 后端 正在处理…                                              │  live row：胶囊 11.5px
├───────────────────────────────────────────────────────────────┤
│  (＋)  ┌───────────────────────────────────────────┐  (发送)   │
│  36px  │ 给 项目 Falcon 发消息                      │           │
│        └───────────────────────────────────────────┘           │
└───────────────────────────────────────────────────────────────┘
```

关键度量（`assets/index-cQAwR5Y3.css`）：

| 元素 | 规则 |
|---|---|
| 容器 `.channel-view` | `position:absolute; inset:0`，整屏盖住主区，`bg-primary` |
| 头部 `.channel-view-header` | `min-height: 56px`（`--channel-view-head-h`），`padding:10px 14px`，`border-bottom:1px solid border-muted` |
| 标题 / 副标题 | 标题 14px/600；副标题 11px `text-tertiary`（成员数、组长） |
| 气泡列 `.channel-bubble-col` | `max-width: min(84%, …)`；用户列 `align-items:flex-end` |
| 成员气泡 `.channel-bubble-member` | `bg-secondary`，圆角 = 16/16/16/**5**（左下收角） |
| 用户气泡 `.channel-bubble-user` | `bg-tertiary`，圆角 = 16/16/**5**/16（右下收角） |
| 气泡内边距 | `8px 12px`，字号 13.5px，行高 1.55 |
| 发言人名字 `.channel-bubble-name` | 11px `text-tertiary`，`margin:0 2px 4px`，只在连续发言的第一条显示 |
| 头像 `.channel-row-avatar` | 22×22，与气泡底对齐，**同一成员连续消息只在第一条出现**（`startOfRun`） |
| `@` 芯片 `.channel-mention-chip` | 行内 `bg-tertiary`，`margin:0 1px` |
| 系统事件 `.channel-system-event` | 居中，12px `text-tertiary` |
| 实时行 `.channel-live-row` | 胶囊 `bg-accent-blue/8%`，11.5px，`margin-left:34px`，含 6px 脉冲点（1.4s） |
| 输入区 `.channel-composer` | `padding:10px 20px 20px`；卡片 `border-radius:20px`，`padding:4px`，`border:composer-border` |
| 输入框 `.channel-composer-input` | `min-height:40px; max-height:9rem`，14px，`padding:9px 14px 9px 4px` |
| 加号按钮 `.channel-composer-plus` | 36×36 |

依据：`index-cQAwR5Y3.css` 中 `.channel-view` / `.channel-bubble-*` / `.channel-composer*` / `.channel-row-*` / `.channel-live-*` 各条规则；JSX 见 `index-osoaH8Sz.js` 中 `channel-row-avatar`、`channel-bubble-col`、`startOfRun` 附近。

#### 侧栏频道行

```
 (头像)  项目 Falcon             [组长]        3
         mcp 的进程已退出，本轮收场。        · 41 未读
```

- `channel-sidebar-lead-badge` 两种态：`is-agent-led`（品牌色描边，文案「组长」）、`is-user-led`（灰底，文案「用户负责编排」）；
- 预览文案优先级：草稿 > 正在处理 > `lastPreview` > 「还没开工」；
- 未读红点来自 `channel.unreadByUser`。

证据：`index-osoaH8Sz.js` 中 `channel-sidebar-lead-badge` 与 `agentHome.channel.draft` / `agentHome.notStarted` 的取值逻辑。

#### 成员列表 / 加人面板

- 头部「资料」打开成员面板：组长置顶 + 一条提示「负责派单、催办和最终收口」，其余成员每人一行（22px 头像 + 名字 + id 前 8 位）；
- 每行 hover 出现：打开对话、设为组长、静音、移出；
- 底部「新建智能体」入口（可直接在频道里造一个新 bot）；
- 加人面板顶部有容量提示「{current}/{max}」「还能添加 N 个智能体」，超限时报「这次添加会超过 12 个智能体的上限」。

证据：`agentHome.channel.memberCap` / `.remaining` / `.overflow` / `.leadDescription` / `.restartMember`；`channel-view-add-panel`、`channel-view-add-cap` 等类名。

### 1.3 交互流程

**发起**：新建 → 选至少 2 个智能体（上限见 `channelMaxMembers`，实测默认 12）→ 起名 → 创建。少于 2 个直接拒绝（`agentHome.channel.needTwo`「频道至少需要两个智能体」）；1:1 的那个默认分身不能进频道（`agentHome.channel.defaultBlocked`）。

**发消息 / @**：

1. 输入框里打 `@` 触发成员补全，下拉按成员颜色渲染，可模糊搜索；`@all` 在成员 >1 时排在第一位，对应「所有智能体」；
2. 选中后插入 `@名字` 芯片，同时把 agentId 写进消息的 `mentionAgentIds`；
3. 发送后只有被 `@` 的成员被唤醒（另有「静音成员」完全不唤醒）。

**接力 / 收场**（这是「bot 之间可被编排」的实现）：被唤醒的成员回答完，可以继续 `@` 下一个成员，把这一棒交出去。壳不需要自己调度，只需要展示 CLI 产生的系统事件：

| 系统事件 key | 文案 |
|---|---|
| `system.turnEnded.exhausted` | 「叫了 {names} 都没人接住，本轮收场」 |
| `system.turnEnded.gone` | 「{name} 的进程已退出，本轮收场」 |
| `system.turnEnded.timeout` | 「本轮超时收场（轮到 {name} 时未见回应）」 |
| `system.turnEnded.muted` | 「{name} 已静音，已跳过这一棒并继续本轮」 |
| `system.turnEnded.silent` | 「多次提醒后 {name} 仍未回应，本轮收场」 |
| `system.turnSkipped.timeout` | 「轮到 {name} 时未见回应，已把这一棒交给下一位」 |

**组长（lead）**：频道可设 `leadAgentId`。有组长时组长负责派单、催办、收口；没有时显示「用户负责编排」。组长可「交回用户」（`leadReturnToUser`）。

**任务板**：频道自带任务列表（`open / claimed / done`），任务事件以系统消息形式落到时间线（`agentHome.taskEvent.*`：创建/派发/认领/完成/催办/停滞）。这部分 v1 不做，见 §3。

### 1.4 数据模型

全部落盘在 `~/.codebuddy/agent-home/`，实测存在：

**`directory.json`**（名册 + 频道索引）

```jsonc
{
  "version": 1,
  "defaultAgentId": "<uuid>",            // 1:1 分身，不能进频道
  "agents": [{
    "id": "<uuid>",
    "name": "评审",
    "avatarVariant": 3,                   // 头像样式序号，1..N
    "homeCwd": "d:/work/project",         // 这个 bot 的工作目录
    "visibility": "visible",
    "title": "接口与安全评审",            // 角色（一行）
    "description": "……",                  // 人设 / 职责（多行，作为该 bot 的系统提示词素材）
    "model": "deepseek-v4.1-flash",
    "permissionMode": "fullAccess",
    "createdBy": "agent",
    "createdByAgentId": "<uuid>",
    "joinTeams": true,
    "depth": 0,
    "primaryJobId": "02a34583",
    "lastActiveAt": 1792464117988,
    "unreadByUser": 0,
    "engine": "…"
  }],
  "channels": [{
    "id": "<uuid>",
    "name": "项目 Falcon",
    "memberAgentIds": ["<uuid>", "<uuid>"],
    "leadAgentId": "<uuid>",              // 可为空 = 用户编排
    "transcriptId": "<uuid>",             // 对应 channels/<id>.jsonl
    "homeCwd": "d:/work/project",
    "visibility": "visible",
    "sortIndex": 1792464117272,
    "createdAt": 1792464117272,
    "createdBy": "user",
    "createdByAgentId": "<uuid>",
    "lastPreview": "评审 完成了 t1",
    "lastActiveAt": 1792647187860,
    "unreadByUser": 41
  }],
  "jobAssignments": {}, "groups": [], "sections": [], "sessionAssignments": {}
}
```

**`channels/<channelId>.jsonl`**（一行一条消息，实测字段）

```jsonc
{"id":"<uuid>","at":1790234272686,"from":"user","text":"…@评审 帮忙看下…","mentionAgentIds":["<uuid>"]}
{"id":"<uuid>","at":1790234299077,"from":"agent","agentId":"<uuid>","text":"收到，我负责…"}
{"id":"<uuid>","at":1790234298816,"from":"user","text":"任务板：派发了 2 个任务…","kind":"task","taskEvent":"dispatched","taskPayload":{...}}
{"id":"<uuid>","at":1790234299077,"from":"system","text":"本轮超时收场（轮到 X 时未见回应）。","kind":"system","systemEvent":{"type":"room-turn-ended","reason":"timeout","names":["X"]}}
{"id":"<uuid>","at":…,"from":"user","text":"下一步先做哪个？","kind":"widget","widget":{"prompt":"…","options":[{"label":"…"}]}}
```

`from` 取值 `user | agent | system`；可选字段：`agentId`、`mentionAgentIds`、`kind`(task/system/widget)、`taskId`、`taskEvent`、`taskPayload`、`replyTo`、`editedAt`、`retractedAt`、`attachments[{file,name,mime,size}]`。

> 实测修正（2026-11-17）：系统消息的 `kind` 是 **`"system"`**，不是本文早期写的 `"systemEvent"`；系统原因在 `systemEvent:{type,reason,names}` 里，`type` 实测为 `room-turn-ended`。壳同时兼容两种写法，并在裁剪时统一成 `kind:"system"`。

**`channels/<channelId>.tasks.json`**

```jsonc
{"version":1,"nextTaskId":3,"tasks":[{
  "id":"t1","subject":"…","status":"open|claimed|done",
  "createdBy":"user","createdAt":…,"updatedAt":…,"detail":"…",
  "assigneeId":"<uuid>","ownerId":"<uuid>","sortIndex":0,
  "refs":[{"kind":"file","value":"engine/loop_engine/config.py"}],
  "wakeCounts":{"<uuid>":1}
}]}
```

**`channels/<channelId>.wake.json`**：`{bucket, wokenIds[], autoWakes[]}` —— 唤醒去重，防止同一条消息把同一个 bot 唤醒两次。

### 1.5 接口

web-ui 的客户端基址：`const DI = '/api/v1/agent-home'`，所有请求带 `X-CodeBuddy-Request: 1`，响应统一 `{data: …}`，错误统一 `{error:{code,message}}`。

| 方法 | 路径（相对 `/api/v1/agent-home`） | 说明 |
|---|---|---|
| GET | `/` | 整份快照：`enabled, orchestrationEnabled, orchestrationConfigured, orchestrationLock, channelMaxMembers, defaultAgentId, agents[], channels[], sections[], groups[], jobAssignments, viewModel, diagnostics, computers` |
| GET | `/channels/{id}/messages/page?before=&after=` | 分页读消息，返回 `{messages[], before, after, hasMore, reset}`，游标是不透明 base64 |
| GET | `/channels/{id}/messages/pinned` | 固定消息，返回 `{messages[], missingMessageIds[], complete}` |
| POST | `/channels/{id}/messages` | 发消息，body `{text, mentionAgentIds?, replyTo?, attachments?}` |
| PATCH / DELETE | `/channels/{id}/messages/{mid}` | 编辑 / 撤回 |
| POST | `/channels` | 建频道 `{name, memberAgentIds}` |
| PATCH / DELETE | `/channels/{id}` | 改名、改成员、设组长 / 删除。静音走 `{mutedAgentIds:[…]}`（整表覆盖） |
| POST | `/channels/{id}/restore` | 恢复 |
| GET / POST | `/channels/{id}/tasks` | 任务板读 / 建 |
| POST | `/channels/{id}/tasks/{tid}/update|complete|move|delete` | 任务操作 |
| GET | `/events?channel={id}` | **SSE**，事件 `snapshot` / `changed` / `keepalive` |
| GET / POST / PATCH | `/agents`、`/agents/{id}` | 智能体名册 CRUD |
| POST | `/agents/{id}/restart` | 重启离线成员（「离线进程重新拉起」） |
| GET | `/computers/...`、`/sections`、`/groups` | 远端机、分组 |

> 实测（2026-11-17）：`messages/page` 不支持 `limit`（传 `limit=30` 仍返回整页）；无游标时返回最近 218 条并带 `hasMore:true`，`before` 再往前翻返回 84 条且 `hasMore:false`，`after=最新游标` 返回 0 条。壳按整页返回并裁字段，不做 200 条截断——否则向上翻页会跳过被截掉的那 18 条。

> 实测静音入口：web-ui 的 `updateChannel` 最终走 `PATCH /channels/{id}`，body 带完整 `mutedAgentIds` 数组；`PATCH /channels/__probe__` 返回 404 `CHANNEL_NOT_FOUND`，证明路由存在。`POST /agents/__probe__/restart` 返回 404 `AGENT_NOT_FOUND`。

> 建频道复核（2026-11-17，源码级）：`gL()` 就是 `POST /channels`，创建弹窗提交 `{memberAgentIds, ...(name.trim()?{name}:{})}`，**body 只有 name 与 memberAgentIds**；组长不在创建请求里，web-ui 是建好后再 `PATCH /channels/{id}` `{leadAgentId}`。`name` 可省略（服务端会生成默认名），壳里强制填名，侧栏才可辨认。`POST /channels` 传非法 JSON 返回 500（JSON 解析错误）而非 404，说明路由存在。

`viewModel`：`{revision, presence:[{agentId, availability}], attention[], activity[], pendingCount, degraded, waiting[]}`。实测 `availability` 出现 `active`；其余枚举未在产物中列出，**实现时未知值一律按空闲处理**（推断：这是「● 正在工作 / ✓ 完成」的来源）。

### 1.6 证据索引

| # | 证据 | 位置 | 关键字符串 |
|---|---|---|---|
| 1 | 频道 API 基址 | `dist/web-ui/assets/index-osoaH8Sz.js` | ``DI=`/api/v1/agent-home` ``，`XI()` 拼 `${DI}${e}` |
| 2 | 全部频道接口 | 同上 | `/channels/${…}/messages/page`、`/channels/${…}/tasks/${…}/complete`、`/events${e?`?channel=…`}` |
| 3 | SSE 事件名 | 同上 | `t===`changed`||t===`snapshot`||t===`keepalive`` |
| 4 | 频道字段 | 同上 | `.memberAgentIds.includes`、`f?.leadAgentId`、`f?.mutedAgentIds??[]`、`f?.pinnedMessageIds??[]` |
| 5 | 界面文案（254 条） | `dist/web-ui/assets/use-i18n-Bg8iRDge.js` | `agentHome.channel.*`、`agentHome.room.*`、`team.*` |
| 6 | 布局度量 | `dist/web-ui/assets/index-cQAwR5Y3.css` | `.channel-bubble-col{max-width:min(84%,…)}`、`.channel-row-avatar{width:22px}`、`.channel-composer-card{border-radius:20px}` |
| 7 | 服务端注册 | `dist/codebuddy-headless.js` | `gM="/api/v1/agent-home"`，`buildRegisteredAgentHomeService(...,["GET","POST","PUT","PATCH","DELETE"])` |
| 8 | ACP 团队协议 | `dist/web-ui/docs/cn%2Fcli%2Facp.md` §「Agent Teams 协议扩展」 | `_meta['codebuddy.ai/teamUpdate']`、`"codebuddy.ai/memberEvent": "tech-architect"`、「客户端收到带 memberEvent 标记的事件后，应将其路由到对应成员的对话时间线」 |
| 9 | 团队产品规格 | `dist/web-ui/docs/cn%2Fcli%2Fagent-teams.md` | `@成员名`、`@all`、`● ✓ ✗ —` 状态、`~/.codebuddy/teams/{name}/config.json` |
| 10 | 落盘结构 | `~/.codebuddy/agent-home/` | `directory.json`、`channels/<id>.jsonl`、`.tasks.json`、`.wake.json` |

---

## 2. 能力判断

### 2.1 可以直接复用（不要自己写）

| 能力 | 复用方式 | 证据 |
|---|---|---|
| bot 名册（名字/头像/角色/模型/工作目录） | `GET /api/v1/agent-home` 的 `agents[]` | 实测 200，`agents[0]` 含 `name, avatarVariant, homeCwd, title, description, model, permissionMode` |
| 频道列表 + 未读数 + 最后一条预览 | 同上 `channels[]` | 实测 `lastPreview`、`unreadByUser`、`leadAgentId` |
| 群聊消息（历史 + 实时） | `messages/page` + `/events` SSE | 实测分页返回 218 条；SSE 收到 `snapshot` 与 2 次 `changed` |
| `@` 谁谁回答 | 直接写 `mentionAgentIds`，唤醒逻辑在 CLI | `~/.codebuddy/agent-home/channels/*.wake.json` 的 `wokenIds` |
| bot 之间接力 / 超时收场 | CLI 产生 `systemEvent` 消息，壳只渲染 | `agentHome.channel.system.turnEnded.*` 六个文案 |
| 成员静音 / 设组长 / 移出 / 重启 | `PATCH /channels/{id}`、`POST /agents/{id}/restart` | 文案 `muteMember`、`makeLead`、`removeMember`、`restartMember` |
| 频道与消息持久化 | CLI 已写盘，壳不建库 | `directory.json` + `channels/*.jsonl` |

### 2.2 必须在壳里实现

| 能力 | 为什么必须在壳里 |
|---|---|
| 群聊视图（左栏频道区 + 消息流 + 输入区） | web-ui 的 React 组件无法复用；壳要按 `docs/design-system.md` 自己的视觉语言重画 |
| `@` 选人 | 现有 `Composer` 的 `@` 已被「连接器」占用（`Composer.tsx:88` `mode: match[2] === '/' ? 'skill' : 'connector'`），必须合并或分流 |
| SSE → 前端事件 | 壳的前端只认 `/api/events` 长轮询（`chat.ts:startPolling`），不直连 CLI 的 SSE；需要后端中转 |
| 频道 id 与 ACP 会话 id 的隔离 | 前端 `handleEvent` 会丢弃 `sessionId !== activeId` 的事件（`chat.ts:350`），频道事件不能用会话 id 空间 |
| 错误与离线态 | `agentHome.sendUnreachable`（「连不上后端服务，文字已保留」）、`refreshDelayed`（「频道更新暂时延迟」）这类降级要在壳里体现 |

### 2.3 做不了 / 不该做

| 想法 | 为什么不做 |
|---|---|
| 在壳里自建 bot 名册和消息表 | 与 `directory.json` 双写必然漂移，正是 `wbl-backend` 明令禁止的「单一事实来源」违背 |
| 壳自己实现「谁接下一棒」的调度 | CLI 已有 `wake.json` 去重、`wakeBudget`、组长催办；自建会双唤醒、双计费 |
| 为每个 bot 起一个 `codebuddy` 子进程 | 端口、文件锁、额度三重浪费；CLI 的频道本来就是进程内多会话 |
| 伪造 `codebuddy.ai/memberEvent` 让会话里出现「多个 bot」 | 该字段由 CLI 产生，壳伪造只能骗自己的前端，且会和真实 team 事件冲突 |
| 直接把 995KB/4s 的 SSE 原样转发给 WebView | 实测 `snapshot` 字节数已达 995KB/4s；WebView 长轮询必须裁剪字段（见 §5.1） |
| 复用 ACP Agent Teams 做「群聊」 | 成员是临时 subagent：无独立名册、无持久化、无角色编辑、`/resume` 不恢复成员；且成员事件目前被壳丢弃（见 §2.4） |

### 2.4 现状核实：ACP 团队事件在壳里是「收得到、看不见」

这是一条重要发现，直接影响 v1 的取舍：

1. CLI 会推：`session_info_update` + `_meta['codebuddy.ai/teamUpdate']`，以及给成员消息打的 `_meta['codebuddy.ai/memberEvent']`（证据 §1.6 #8）。
2. 壳收得到：`AcpClient` 收到后走 `normalizeUpdate`。
3. 但 `normalize.cpp:187` 只认 `codebuddy.ai/workflowEventKind`；没有它的一律降级成 `raw_update`。
4. 前端 `applyEvent` 的 `default: return messages`（`frontend/src/lib/messages.ts:354`）把它丢掉。
5. 成员消息更早就没了：`backend.cpp:1130` `if (uiId.empty()) return;` —— 成员的 ACP 会话 id 不在 `acpToUi_` 里，事件被静默丢弃。
6. 即使侥幸进来，`appendText` 也不带成员归属，文本会混进同一条助手气泡里。

结论：**现在如果用户在壳里让 CLI 组队，界面上看起来是「卡住」的**。这是一条应该修的 bug，但它不是「群聊」，修它属于 v2 的「会话内团队看板」。

---

## 3. v1 范围（克制）

### 3.1 做

**目标：一个能真正用起来的群聊闭环——看频道、看历史、@ 一个 bot、看它回答、看它把活交给下一个 bot。**

1. **左栏「团队」区**：列出 `channels[]`（头像、名字、组长徽标、最后一条预览、未读）。点击进入频道；再点当前会话区退出回主对话。
2. **频道视图**：头部（名字 / 成员数 / 组长 / 资料）、消息流（成员左气泡、用户右气泡、`@` 芯片、系统事件居中、`正在处理` 实时行）、输入区。
3. **`@` 选人**：`@` 弹出合并面板，分两组「本频道智能体」与「连接器」，选智能体插入芯片并记 `mentionAgentIds`；`@all` 映射为「所有智能体」。
4. **发送**：`POST /api/team/send` → 本地立即回显 → SSE 回来后按 id 去重合并。
5. **成员面板（只读 + 静音）**：看成员角色、谁是组长、在线状态；支持「静音 / 取消静音」「重启成员」两个操作。新建频道见 §10；删频道、改组长留到 v2。
6. **降级**：CLI 未就绪、频道接口 4xx/5xx、SSE 断流，都要有明确文案，不出现空屏。

### 3.2 不做（明确留给 v2）

| 项 | 为什么 |
|---|---|
| bot 自主互相聊天（自主唤醒、自动接力开关） | 每次唤醒 = 一次完整 agent run，会持续烧额度；v1 只允许「人工 `@` 才醒」 |
| 群成员管理（增删成员、改角色/系统提示词） | v1 只读 + 静音；v2 第一波已实现增删成员、设/撤组长与 bot 人设编辑，见 §11 |
| 消息引用 / 编辑 / 撤回 / 固定 | 接口都有，但 UI 成本高，先不做 |
| 任务板 | 独立一套交互（拖拽、认领、完成），v1 用 `systemEvent` 展示即可 |
| 附件上传 | 需要 presign/upload 链路，v1 只发文本 |
| 会话内 ACP 团队看板 | 见 §2.4，是另一条线 |
| 频道跨工作空间 | v1 跟随 CLI 现状（频道自带 `homeCwd`），不做切换 |

---

## 4. 实现映射

### 4.1 后端：`src/backend.cpp`

先补一个写代理（现在只有 `agentGet`，`backend.cpp:1350`）：

```cpp
// 与 agentGet 同源：同一个 host_->baseUrl()，同一个 X-CodeBuddy-Request: 1
// 不解包 data，把 CLI 的 {data}/{error} 原样交给上层裁剪；额外带 HTTP status 与 timeout 标记
json Backend::agentSend(const std::string& method, const std::string& path, const json& body,
                        int timeoutSec = 10);
```

路由（沿用 `setupRoutes()` 现有风格，全部**不走 job 模式**——这些是毫秒级 HTTP 调用，不是子进程）：

| 方法 | 路径 | 入参 | 返回 | job |
|---|---|---|---|---|
| GET | `/api/team/state` | – | `{enabled, orchestrationEnabled, channelMaxMembers, defaultAgentId, agents[], channels[], presence[]}` | 否 |
| GET | `/api/team/messages` | `channelId`, `before?` | `{messages[], hasMore, before}` | 否 |
| POST | `/api/team/send` | `{channelId, text, mentionAgentIds[]}` | `{ok, message}` | 否 |
| GET | `/api/team/events` | `from`, `channelId`, `wait` | `{events[], lastSeq}` | 否 |
| POST | `/api/team/member` | `{channelId, agentId, muted}` | `{ok, channel}` | 否 |
| POST | `/api/team/member/restart` | `{agentId}` | `{ok}` | 否 |

返回形状（`state`，字段直接照抄 CLI，仅做裁剪）：

```jsonc
{
  "enabled": true,
  "orchestrationEnabled": true,
  "channelMaxMembers": 12,
  "defaultAgentId": "<uuid>",
  "agents": [{
    "id": "<uuid>", "name": "评审", "avatarVariant": 3,
    "title": "接口与安全评审",
    "model": "deepseek-v4.1-flash", "permissionMode": "fullAccess",
    "homeCwd": "d:/work/project", "lastActiveAt": 1792464117988
  }],
  "channels": [{
    "id": "<uuid>", "name": "项目 Falcon",
    "memberAgentIds": ["<uuid>"], "leadAgentId": "<uuid>",
    "mutedAgentIds": [],
    "lastPreview": "…", "lastActiveAt": 1792647187860, "unreadByUser": 41,
    "homeCwd": "d:/work/project"
  }],
  "presence": [{ "agentId": "<uuid>", "availability": "active" }]
}
```

不可用时返回同一形状的空列表，附带降级字段（前端据此显示文案并重试）：

```jsonc
{ "enabled": false, "reason": "连不上 CodeBuddy 频道服务：…", "retry": true,
  "agents": [], "channels": [], "presence": [] }
```

要点：

- **必须裁字段**。实测 `/api/v1/agent-home` 单次快照 11,207 B（5 个 agent / 2 个频道）；SSE `snapshot` 4 秒 995 KB。`/api/team/state` 只回上面这些，实测裁剪后 **2,863 B（25.5%）**；`events` 只回增量 `messages`（按 id 去重）。
- `agents[].description` 可能很长（实测有一条人设写到数百字，含多段）。列表态只用 `title`，**`description` 完全不出现在 state**；v1 成员面板只显示 `title/model`。
- `agents` 里排除了 `defaultAgentId`（1:1 分身不能进频道），避免用户在 `@` 面板里误选。
- 频道事件不带会话 id：`data` 为 `{seq, type:"channel", sessionId:"", channelId, message}`，`sessionId` 置空、`type` 用 `"channel"`；这样 `chat.ts:350` 的会话过滤不会误伤，`applyEvent` 的 `default` 也不会误画。
- `POST /api/team/send` 加 15s 超时：CLI 侧是「先落消息、再异步唤醒」，实测坏请求 400 立即返回；**写操作本轮未实测内容变更**（会改用户数据），超时按「已发送、回复稍后到」处理，不重试（会重复发消息）。
- **实测 `presence.availability` 恒为 `active`**（包括空闲成员），不能拿它判断「正在处理」。壳的实时行用本地状态推导：发送后把被 `@` 且未静音的成员标为 working，收到该成员消息或任意系统事件时清除，90s 兜底清除。
- demo 模式（`demo_`）返回固定 fixture：4 个 bot、2 个频道、24 条消息（成员/用户/系统事件/`@` 芯片/连续消息），不碰 CLI。

### 4.2 前端

**新增 store `frontend/src/store/team.ts`**（不塞进 `chat.ts`，理由：`chat.ts` 的 `activeId` 语义是 ACP 会话，混用会让 `loadSession`/`send` 走错分支）

| 字段 | 类型 | 说明 |
|---|---|---|
| `enabled` | `boolean` | 频道能力是否可用 |
| `orchestrationEnabled` | `boolean` | 是否允许 bot 自主唤醒；v1 只用于提示「当前会自动唤醒」 |
| `agents` | `TeamAgent[]` | 名册 |
| `channels` | `TeamChannel[]` | 频道列表 |
| `activeChannelId` | `string \| null` | **非空时主区渲染 `ChannelView`，否则渲染 `ChatThread`** |
| `messages` | `ChannelMessage[]` | 当前频道消息，按 `id` 去重 |
| `presence` | `Record<string, string>` | agentId → availability（实测恒为 `active`，只用于状态点，不用于判断忙碌） |
| `lastSeq` | `number` | 长轮询游标 |
| `sending` | `boolean` | 发送中 |
| `pendingMentions` | `string[]` | 本条消息要 @ 的 agentId |

方法：`loadState()`, `openChannel(id)`, `closeChannel()`, `loadMore()`, `send(text)`, `toggleMute(agentId)`，另有 `restartAgent` 与截图用的 `requestMentionPanel(agentId?)`。

**组件树**

```
App
├─ Sidebar
│   └─ TeamSection                 # 新增：channels 列表，id=team-channel-<id>
│       └─ TeamChannelRow          # 头像 / 名字 / 组长徽标 / 预览 / 未读
├─ main
│   ├─ ChannelView  (activeChannelId 非空)   # 新增，id=channel-view
│   │   ├─ ChannelHeader           # 名字 / n/12 成员 / 组长 chip / 资料按钮
│   │   ├─ ChannelThread
│   │   │   ├─ ChannelSystemEvent  # 居中灰字
│   │   │   ├─ ChannelMessageRow   # startOfRun 才画头像
│   │   │   └─ ChannelLiveRow      # 「X 正在处理…」脉冲
│   │   └─ ChannelComposer
│   │       ├─ MentionPalette      # 复用 Composer 的 palette 外壳
│   │       └─ MentionChip
│   └─ ChatThread + Composer  (activeChannelId 为空)
└─ ChannelMembersPopover           # 成员面板（只读 + 静音 + 重启）
```

**复用什么**

| 现有件 | 用法 |
|---|---|
| `MarkdownPart` | 频道消息正文直接复用（成员会输出 markdown） |
| `ui/Popover`、`ui/Tooltip`、`ui/Dialog` | 成员面板、组长说明、删除确认 |
| `Composer` 的 palette 外壳与键盘处理（`detectPalette`、`filterItems`、↑↓/Enter/Esc） | 扩一个 `mode: 'member'`，不要另写一套 |
| `EmptyState` 的排版规则 | 空频道：「给这频道发第一条」 |
| `sonner` toast | 发送失败、重启成员结果 |

**必须新写、但很小**

- `BotAvatar`：22px 圆形，颜色由 `agentId` 稳定哈希决定（CLI 用 `avatarVariant` 序号，壳没有素材，用「首字 + 稳定色」代替）；右下 6px 状态点。
- 气泡：**不照抄 CodeBuddy 的 16/5**（超出本仓库 token 上限）。用 `rounded-xl`（12px）做主体、`rounded-bl-sm` / `rounded-br-sm`（4px）做收角，颜色只用 `bg-surface-2` / `bg-surface-3`。CodeBuddy 的 16/5 只作为「哪一侧收角」的参考，不作为数值参考。

**截图钩子**（`App.tsx:83` 现有 `window.__wbl` 的同一处追加，供 `wbl-visual-check` 用）

| 钩子 | 作用 |
|---|---|
| `__wbl.openTeam()` | 打开团队区（demo 下同时灌 fixture） |
| `__wbl.openChannel(id)` | 切到指定频道 |
| `__wbl.teamSend(text)` | 在当前频道发一条 |
| `__wbl.mention(agentId)` | 模拟在 `@` 面板里选中一个 bot（用于截 palette 态） |

**`@` 冲突的处理（这是 v1 唯一的交互取舍）**

现状：`@` = 连接器（`Composer.tsx:88`）。方案：**一个面板两组结果**，顺序为「本频道智能体」→「连接器」，用一条分隔线分开（CLI 也是这个做法：`agentHome.channel.plus` 叫「提及」，连接器走附件菜单）。选中智能体 → 插入芯片 + 记 id；选中连接器 → 保持现有行为。键盘规则不变。

不采用「`@` 给 bot、`#` 给连接器」：会破坏已有用户肌肉记忆，且 `#` 在现有代码里没有语义。

实现补充：频道消息的 API 只有 `text + mentionAgentIds`，没有连接器参数。因此频道 composer 的第二组「连接器」保留展示（满足一个面板两组结果），但选中时只提示「频道消息暂不支持连接器」，不伪造一个发不出去的引用。会话 composer 的 `@` 仍然只走连接器，行为不变。

**视觉红线**（`docs/design-system.md`）

- 只许 `bg-surface-2` / `bg-surface-3` / `text-ink-2|3|4` / `border-border` / `text-ok|warning|err`；不写 hex。
- 正文 13.5/1.75；元信息 10.5–11；不用彩色胶囊表达状态，运行中用脉冲点。
- 动效 120–160ms，脉冲 2s，不做位移。
- 键盘：Esc 退出频道 / 关闭面板，↑↓ + Enter 选人，Tab 可达。

---

## 5. 验收标准

### 5.1 demo 模式（不消耗额度，可截图）

启动：`bin/workbuddy-lite.exe --demo`

| 检查点 | 怎么点 | 预期 | 截图 |
|---|---|---|---|
| 左栏出现团队区 | `window.__wbl.openTeam()` | 2 个频道，其中一个带「组长」徽标，一个有未读 | `bin/visual/team-rail-light.png` |
| 频道视图 | 点 `#team-channel-demo-1` | 头部 4/12 成员；历史里有成员气泡、用户气泡、系统事件、连续消息只画一次头像 | `bin/visual/team-channel.png` |
| `@` 面板 | `__wbl.mention('demo-agent-review')` | 两组结果：「本频道智能体」5 条（含所有智能体）+「连接器」若干，↑↓ 可走 | `bin/visual/team-mention.png` |
| 成员面板 | 点头部「资料」 | 组长置顶、3 名成员、静音按钮、离线成员的「重启」 | `bin/visual/team-members.png` |
| 实时行 | `__wbl.teamSend('@评审 看下接口')` 后 0.5s | 用户气泡右对齐 +「评审 正在处理…」脉冲行 + 侧栏预览切到「正在处理」 | `bin/visual/team-live.png` |
| 发送 + 接力 | 同上，等 3s | 用户气泡 → 评审气泡 → 「评审 把这一棒交给 后端」系统行 → 后端气泡 | `bin/visual/team-relay.png` |
| 深色 | 切 `.dark` 重截一张 | 气泡、芯片、灰字层次仍可读，无硬编码色残留 | `bin/visual/team-dark.png` |

检查方法：`ViewImage` 看四张图，重点看「头像只在首条出现」「用户/成员气泡圆角方向相反」「系统事件居中不抢眼」「1280px + 右栏展开时头部不换行」。

### 5.2 真实模式（不消耗额度）

1. **只读验证（零额度）**：启动真实模式，只打开团队区、点开频道、往上翻历史。
   - 预期：能读到真实频道与历史消息；**不点发送就不会有任何 agent run**。
   - 验证点：任务管理器里没有新增 `codebuddy` 进程；`bin/_workspace` 日志无 `usage_update`。
2. **不唤醒的写入验证（零额度）**：新建一个只含**已静音**成员的频道，发一条不带 `@` 的消息。
   - 预期：消息落库并在时间线出现，`systemEvent` 显示「已跳过这一棒」，没有模型调用。
3. **一次真实唤醒（最小额度）**：房间里只放两个 bot，选最便宜的模型，`@` 其中一个，问一句「回一个字：好」。
   - 预期：一次 run、一条回复、`usage` 面板出现一行；另一个 bot 不被唤醒。
   - 额度自检：发送前后各读一次 `/api/usage`，差额应等于一次 run。

---

## 6. 风险与开放问题

### 风险

| 风险 | 影响 | 处理 |
|---|---|---|
| 每个 bot 回复 = 一次完整 agent run | 一个 5 人频道被 `@all` 一次 = 5 次计费 | 发送前显示「将唤醒 N 个智能体」；`@all` 需二次确认 |
| `orchestrationEnabled=true` 时 bot 会自主接力 | 无人看着也会持续烧额度 | v1 只展示该开关状态，并在头部常驻提示；不做「替用户打开」 |
| SSE `snapshot` 极大（实测 995KB/4s） | WebView 长轮询被打满、界面卡 | 后端不走 SSE：用 `messages/page?after=` 只取增量 + 裁剪；单次队列上限 200 条。REST 快照本身只有 11KB |
| 写操作本轮**未实测** | POST 的真实时延/幂等未知 | 实现时先加超时 + 禁止自动重试；第一次联调只发一条 |
| 频道未读数被多客户端同时改写 | 壳与网页端互相把未读清零 | v1 不在壳里改 `unreadByUser`；只在打开时本地清零 |
| 频道 `homeCwd` 与当前工作空间不一致 | bot 改的是另一个目录 | 头部显示 `homeCwd` 末段；与当前工作空间不同时给一条提示 |
| CLI 版本差异 | 旧版本没有 `/api/v1/agent-home` | 启动探测：404 就整体隐藏团队区，不报错 |
| **两个 `--serve` 实例争 agent-home 的协调权** | 壳自己会起一个 `--serve`（`agent_host.cpp:119`），用户可能同时开着另一个；`agent-home` 下有单实例的 `coordinator.json`（单 `pid`）与 `coordination.sqlite`，可能出现「壳里发的消息对方的实例看不到」或唤醒丢事件 | **必须先做一次 spike**：同时起两个实例，各发一条消息，确认 `directory.json` 与 `channels/*.jsonl` 是否共享、`coordinator.epoch` 是否互踢。未验证前不要把 v1 定位成「与网页端同时使用」 |

### 需要拍板的三个点

1. **bot 从哪来？**
   - 方案 A（建议）：复用 agent-home 的「AI 同事」——持久、有 `title`/`description`/`model`/`homeCwd`，跨会话可用；
   - 方案 B：会话内 ACP subagent/team——临时、无角色管理、`/resume` 不恢复成员。
   - 建议 A，因为用户要的是「每个 bot 有角色/技能」和「群聊」，这两点只有 A 有。

2. **群聊是独立实体，还是绑在某个会话上？**
   - CLI 现状：频道是独立实体（自带 `homeCwd`），不属于任何 ACP 会话；
   - 若要求「群聊必须挂在当前会话下」，就得在壳里建映射表，并处理会话删除/切换——成本高且有双写风险。
   - 建议先按 CLI 现状做独立实体，左栏与「会话」并列；等 v2 再讨论绑定。

3. **允许 bot 自主接力吗？**
   - 开：更像真群聊，但无人值守也会持续计费；
   - 关：只有 `@` 才回答，可预测、可报销。
   - 建议 v1 关（壳不改该开关，只在头部提示当前状态），v2 再给一个显式开关。

---

## 7. 测试场景

### 7.1 正常流程：两个 bot 接力

1. demo 模式打开频道 `demo-1`（成员：评审、后端、组长）。
2. 输入 `@评审 先看接口契约，安全那块交给 @后端`，回车。
3. 断言：
   - 用户气泡立即出现（右对齐、`bg-surface-3`、右下收角）；
   - 1s 内出现「评审 正在处理…」实时行，脉冲点可见；
   - 评审气泡到达（左对齐、头像 22px、名字 11px `text-ink-3`）；
   - 随后出现居中系统行「评审 把这一棒交给 后端」；
   - 后端气泡到达，且**不再重复画头像**（同一成员连续消息合并）；
   - 输入框在整轮结束后恢复可用，`sending` 归 false。
4. 截图：`team-relay.png`。

### 7.2 异常流程：被 @ 的 bot 已退出

1. 真实模式下，频道里有一个成员对应的进程已退出（`presence` 里没有它，或 `availability` 非 active）。
2. `@该成员` 发一条消息。
3. 断言：
   - 消息仍然落库并显示（不因为 bot 挂了就丢消息）；
   - 2s 内出现系统行「{name} 的进程已退出，本轮收场」（对应 `agentHome.channel.system.turnEnded.gone`）；
   - 实时行消失，输入框恢复，**不出现无限「正在处理」**；
   - 成员面板里该成员显示「重启成员」按钮，点击后 toast 提示「已重新拉起该成员」或「重启失败：{reason}」。
4. 若 CLI 侧返回 4xx/5xx：toast 显示 `error.message`，输入框内容保留（对应 `agentHome.sendUnreachable`「文字已保留，重试即可」）。

### 7.3 回归（不能弄坏现有功能）

- 主对话仍需正常工作：`activeChannelId` 置空后 `ChatThread` + `Composer` 与改动前一致；
- `@` 选连接器的老路径仍可用（选连接器后 chip 与发送参数不变）；
- 1280px + 右栏展开时，左栏新增的团队区不把会话列表挤到不可用。

---

## 8. 附：本轮实测记录（只读）

本机 `codebuddy --serve` 在 `127.0.0.1:8390`（PID 19900，与 `~/.codebuddy/agent-home/coordinator.json` 的 pid 一致）。

| 请求 | 结果 |
|---|---|
| `GET /api/v1/health` | `{"status":"ok",…,"platforms":["generic","wecom","wechat-kf"]}` |
| `GET /api/v1/agent-home` | 200，`data` 含 `enabled/orchestrationEnabled/channelMaxMembers/defaultAgentId/agents/channels/sections/viewModel/diagnostics` |
| `GET /api/v1/agent-home/channels/{id}/messages/page` | 200，`{messages:218, before, after, hasMore:true, reset:false}` |
| `GET /api/v1/agent-home/events?channel={id}`（4s） | `event: snapshot` ×1、`event: changed` ×2，共 995KB |
| `PATCH /api/v1/agent-home/channels/__probe__` | 404 `{"error":{"code":"CHANNEL_NOT_FOUND"}}` —— 路由存在，只是 id 不存在 |
| `POST /api/v1/agent-home/channels/__probe__/messages` `{}` | 400 `{"error":{"code":"BAD_REQUEST","message":"text or an attachment is required"}}` |

未做的事，以及为什么：

- **没有启动 web-ui 截图**：SPA 需要登录态，且打开它会改写 `unreadByUser`（实测已有 41 未读），属于改动用户可见状态。因此界面部分用 CSS 真实度量 + JSX 结构还原成线框图，未伪造截图。
- **没有对真实频道执行写操作**（建频道、发消息、改成员）：会改用户数据。只对不存在的 `__probe__` 发了 PATCH / restart 探针，拿到 404，确认路由存在；真实写入的时延与幂等性按「未验证」处理，见 §9.4。
- **没有跑 `codebuddy --serve` 新实例**：会与用户正在用的实例争 `agent-home` 的 sqlite 锁与 coordinator。

复现方式（只读，可随时重跑）：

```bash
curl -s -H "X-CodeBuddy-Request: 1" http://127.0.0.1:8390/api/v1/agent-home | head -c 400
curl -s -H "X-CodeBuddy-Request: 1" \
  "http://127.0.0.1:8390/api/v1/agent-home/channels/<channelId>/messages/page" | head -c 400
timeout 4 curl -s -N -H "X-CodeBuddy-Request: 1" -H "Accept: text/event-stream" \
  "http://127.0.0.1:8390/api/v1/agent-home/events?channel=<channelId>" | head -c 400
```

---

## 9. v1 实现记录（2026-11-17）

### 9.1 真实接口复核（只读）

| 请求 | 结果 | 字节 |
|---|---|---|
| `GET /api/v1/agent-home` | 200；5 agents / 2 channels / 5 presence | 11,207 B |
| 同上，按 §4.1 字段集裁剪（模拟 `/api/team/state`） | — | **2,863 B（25.5%）** |
| `GET .../channels/{id}/messages/page` | 200；218 条；`hasMore:true` | 261,992 B |
| 同上，按 `trimTeamMessage` 裁剪 | — | **232,056 B（88.6%）**；文本占大头 |
| `GET .../messages/page?before=<游标>` | 200；84 条；`hasMore:false` | 98,985 B |
| `GET .../messages/page?after=<最新游标>` | 200；0 条 | 286 B |
| `GET .../events?channel={id}`（4s） | `snapshot` ×1、`changed` ×2 | **995,188 B** |
| `PATCH .../channels/__probe__` | 404 `CHANNEL_NOT_FOUND`（路由存在） | 79 B |
| `POST .../agents/__probe__/restart` | 404 `AGENT_NOT_FOUND`（路由存在） | 75 B |

结论：**995KB/4s 是 SSE 快照，不是 REST 快照**；REST 快照只有 11KB，但 SSE 不能直接转发给 WebView。v1 用 `messages/page?after=` 做增量，完全绕开 SSE。消息正文是主要体积，裁剪只能省 11%，所以初始页按整页返回（218 条），不做 200 条截断以免翻页丢消息。

### 9.2 落地文件

- 后端：`src/backend.h` / `src/backend.cpp`
  - `agentSend(method, path, body, timeoutSec)`：与 `agentGet` 同源同 header，返回 `{status, doc, error?}`，不解包 `data`。
  - 6 个路由：`GET /api/team/state`、`GET /api/team/messages`、`POST /api/team/send`、`GET /api/team/events`、`POST /api/team/member`、`POST /api/team/member/restart`。
  - `TeamWatch`：每频道一条 after 游标 + 增量队列，长轮询 700ms 轮询 CLI 分页；队列上限 200 条。
  - demo fixture：4 bot / 2 频道 / 24 条消息；接力回复用 `pending[{dueAt,…}]` 到期投放，不开后台线程。
- 前端：`frontend/src/store/team.ts`、`frontend/src/components/team/*`、`frontend/src/components/composer/palette.ts`
  - store 独立于 `chat.ts`；`activeChannelId` 非空时 `App` 主区渲染 `ChannelView`。
  - `@` 面板复用 `detectPalette/filterItems/paletteStep`；频道面板两组「本频道智能体 / 连接器」，连接器在频道内只提示不可用。
  - 截图钩子：`__wbl.openTeam()`、`openChannel(id)`、`teamSend(text)`、`mention(agentId)`。

### 9.3 验证结果

- `frontend`: `npm run build` 通过；`npm run lint` 全仓 0 error / 22 条既有 warning，新增文件单独跑 `oxlint` 为 0 warning。
- 后端：`bin/workbuddy-lite.verify.exe` 编译通过（未覆盖/未占用用户正在运行的 `bin/workbuddy-lite.exe`）。
- demo 截图（`bin/visual/`）：`team-rail-light.png`、`team-channel.png`、`team-mention.png`、`team-members.png`、`team-live.png`、`team-relay.png`、`team-channel-panel.png`、`team-dark.png`。
- 回归：`node scripts/visual-check.mjs --out bin/visual/regression` 三张（chat / workbench / empty）通过；旧后端 + 新前端时团队区显示「团队不可用」，会话、市场、工作台正常。

### 9.4 遗留风险

- **两个 `--serve` 实例争 agent-home 协调权**：本轮没有起第二个实例，风险未消除；壳与外层网页端同时写入时仍可能出现消息/唤醒不一致。
- **写操作只验证了「路由存在」**：`PATCH` 静音、`POST` 发送/重启未对真实频道执行，真实时延、`expectedRevision` 冲突与幂等性未知。代码已按「15s 超时视为已发送、不重试」处理。
- **`presence.availability` 恒为 `active`**：不能从 CLI 读到「谁在跑」；实时行是本地推导，极端情况下（bot 已读但不回复）最多显示 90s。
- **未读数只本地清零**：不回写 `unreadByUser`，与网页端同时打开时可能各自看到不同的未读数。

---

## 10. v1.5 新建频道（2026-11-17）

### 10.1 范围

侧栏「团队」区底部加「新建频道」；弹窗填名字、多选成员（至少 2 个、上限 `channelMaxMembers`、默认分身不可选）、可选组长；创建成功自动进入该频道。只做「建」，不删、不改已有频道的成员。

### 10.2 接口

| 方法 | 路径 | 入参 | 返回 |
|---|---|---|---|
| POST | `/api/team/channel` | `{name, memberAgentIds[], leadAgentId?}` | `{ok, channel, warning?}` / `{ok:false, error}` |
| ↳ 上游 | `POST /api/v1/agent-home/channels` | `{name, memberAgentIds[]}` | `{data:{channel}}` |
| ↳ 上游（选组长时） | `PATCH /api/v1/agent-home/channels/{id}` | `{leadAgentId}` | `{data:{channel}}` |

校验在壳里完成：名字非空且 ≤30 字、去重后的成员 ≥2 且 ≤`channelMaxMembers`、组长必须是成员、默认分身直接拒绝。**重名检查只在壳里做**（CLI 允许同名），避免侧栏出现两个一模一样的频道。

`GET /api/team/state` 新增 `canCreate: true`：旧 exe 没有 `/api/team/channel`，前端据此隐藏入口，避免新前端配旧后端时点了才 404。

### 10.3 落地文件

- 后端：`src/backend.cpp` / `src/backend.h`
  - `handleTeamCreate()`：校验 → 真实模式 `POST /channels`（20s）→ 可选 `PATCH` 设组长（10s）。
  - 组长失败**不回滚频道**，返回 `warning`，前端用 toast.warning 展示；成功时把 `leadAgentId` 补进返回对象（PATCH 响应可能是部分频道）。
  - `demoTeamCreateChannel()`：真的往 `demoTeam_` 插一条频道与空消息数组，侧栏与频道视图立即可用。
- 前端：`frontend/src/components/team/CreateChannelDialog.tsx`（新增）、`TeamSection.tsx`、`store/team.ts`、`lib/api.ts`、`App.tsx`
  - 弹窗进入时重置状态；提交失败保留已选成员与名字。
  - 截图钩子：`__wbl.newChannel()`。

### 10.4 验证

- `frontend npm run build` 通过；`bin/workbuddy-lite.verify.exe` 编译通过。
- demo 截图（`bin/visual/`）：`create-channel-open.png`（3 个成员选中）、`create-channel-one-member.png`（1 个成员、按钮禁用）、`create-channel-duplicate.png`（重名禁用）、`create-channel-dark.png`、`create-channel-created.png`（侧栏出现新频道并自动进入）、`create-channel-lead.png`（组长徽标与头部「组长 安全」）。
- v1 回归：`v15-team-channel.png`、`v15-team-mention.png`、`v15-team-members.png`；`visual-check.mjs` 三张（`regression-v15/`）+ 插件市场一张。

### 10.5 遗留风险

- **真实建频道尚未联调**：`POST /channels` 只做了「非法 JSON → 500」的路由存在性探针，没有在真实 `agent-home` 上创建过频道（会改用户数据）。真实返回的 `channel` 字段是否完整、重名是否真的被允许，都按「未验证」处理。
- **设组长是第二次 PATCH**：不是原子操作。若 PATCH 失败，频道已经存在（无组长），用户需要重进频道手动设或删除重建；壳用 warning 提示。
- 建频道没有幂等键：超时后不重试，避免出现两个同名频道；前端此时会报错并保留弹窗内容，用户可自行重试。

---

## 11. v2 第一波：成员管理 + bot 人设 + 新建智能体（2026-11-18）

### 11.1 范围

在 v1「只读 + 静音」的基础上补齐四件事，全部复用 agent-home 的写接口，壳里不另存名册：

1. 频道成员增删（全量替换）；
2. 设/撤组长（`leadAgentId` 传 `null` 即交回用户编排）；
3. 查看/编辑 bot 的 `name` / `title` / `description`（人设与内部提示词）；
4. 新建智能体，并可直接加入当前频道。

不做：删除 bot、改头像、在详情里改模型/权限/工作目录、编辑 `systemPrompt` 的 append/replace 模式、任务板。

### 11.2 真实接口（源码级反查 + 404 探针）

反查对象：本机 CLI `2.184.0` 的 `dist/web-ui/assets/index-A0XYmDEG.js` 与 `dist/codebuddy-headless.js`。所有路径相对 `/api/v1/agent-home`。

| 方法 | 路径 | 服务端方法 | 返回 | 用途 |
|---|---|---|---|---|
| PATCH | `/channels/{id}` | `updateChannel` | `{data:{channel}}` | 成员全量替换、设/撤组长、改名、静音 |
| POST | `/channels` | `createChannel` | `{data:{channel}}` | v1.5 建频道，未变 |
| POST | `/agents` | `createAgent` | `{data:{agent}}` | 新建 bot |
| PATCH | `/agents/{id}` | `updateAgent` | `{data:{agent,groups,channels}}` | 改 name/title/description/model/engine/… |
| GET | `/agents/{id}` | **不存在** | — | 单个 bot 详情只能读整份目录后挑选 |

`PATCH /channels/{id}` 实际读取的 body：

```jsonc
{
  "memberAgentIds": ["…"],     // 全量替换；<2 → 400，新增后 > 上限 → 400
  "leadAgentId": "…" | null,   // null 显式清空；必须是频道成员
  "mutedAgentIds": ["…"],      // 全量替换，必须在成员内
  "name": "…",
  "expectedRevision": 2        // 可选；带过期值 → 409 CHANNEL_REVISION_CONFLICT
}
```

- 不传 `leadAgentId` 时，若原组长已不在新成员里，服务端会自动清空。
- 每次成员/组长/名字变更 `governanceRevision` +1。
- 错误码：404 `CHANNEL_NOT_FOUND`、409 `CHANNEL_REVISION_CONFLICT`、
  400 `CHANNEL_MEMBERS`（人数）、400 `BAD_REQUEST`（`leadAgentId must identify a channel member` 等）。

`POST /agents` / `PATCH /agents/{id}` 的可用字段：

```jsonc
{
  "name": "…",          // 上限 60 字
  "title": "…",         // 上限 60 字；PATCH 传空串 = 删除该字段
  "description": "…",   // 人设/内部提示词素材；上限 2000 字；PATCH 空串 = 删除
  "model": "…", "engine": "…", "permissionMode": "…", "homeCwd": "…",
  "visibility": "visible" | "hidden", "avatarVariant": 1
}
```

探针（不存在的 id，只验证路由，不写真实数据）：

| 请求 | 结果 |
|---|---|
| `PATCH /channels/__probe__` | 404 `CHANNEL_NOT_FOUND` |
| `PATCH /agents/__probe__` | 404 `AGENT_NOT_FOUND` |
| `GET /agents/__probe__` | 404（该路由不存在） |

`POST /agents` 没有做空 body 探针：服务端会给缺省名 `New Agent` 并真的落盘，属于写操作。

### 11.3 壳路由（`src/backend.cpp`）

风格与 `/api/team/*` 一致，全部毫秒级、不走 job；写操作统一 15s 超时、不重试。

| 方法 | 路径 | 入参 | 返回 |
|---|---|---|---|
| PATCH / POST | `/api/team/channel/members` | `{channelId, memberAgentIds[], expectedRevision?}` | `{ok, channel}` |
| POST | `/api/team/channel/lead` | `{channelId, leadAgentId: string\|null, expectedRevision?}` | `{ok, channel}` |
| GET | `/api/team/agent?id=` | – | `{ok, agent}`（含 `description`） |
| POST | `/api/team/agent` | `{name, title?, description?, model?, homeCwd?}` | `{ok, agent}` |
| PATCH | `/api/team/agent` | `{agentId, name?, title?, description?}` | `{ok, agent, channels?}` |

- `GET /api/team/state` 新增 `canManage: true`；旧 exe 没有这个字段，前端据此把成员面板降级为只读。
- `trimTeamChannel` 增加 `governanceRevision`，写回时作为 `expectedRevision`，避免静默覆盖网页端的改动。
- 上游英文错误在 `teamWriteErrorText` 里翻成中文（频道不存在、没有权限、组长必须是成员等）。

### 11.4 校验

成员（`/channel/members`）：

- `channelId` 合法；成员去重后 2..`channelMaxMembers`；
- 每个 id 必须在 `state.agents[]` 里（已排除默认分身与 hidden）；
- 显式拒绝 `defaultAgentId`：「默认分身不能加入频道，请换一个成员」；
- 组长若被移出，响应会带回清空后的 `leadAgentId`。

bot：

- `name` 非空、≤60 字、与名册里其他 bot 不重名（壳里做，CLI 允许同名）；
- `title` ≤60 字；`description` ≤2000 字，允许清空；
- 新建时 `model` 可省略 → 服务端默认；详情页只编辑 name/title/description，model/permissionMode/homeCwd 只读展示。

### 11.5 demo 行为

- fixture 里 4 个 bot 都补了多段人设（`description`），列表接口仍按真实形状裁掉，只有详情接口返回。
- 成员替换：真实修改 `demoTeam_` 的 `memberAgentIds`，同步清掉已移出成员的静音与组长，并自增 `governanceRevision`。
- 设/撤组长：直接改 fixture 的 `leadAgentId`。
- 新建 bot：插入 `demoTeam_["agents"]`，id 形如 `demo-a-<ms>`；随后可被加入频道。
- demo 实测（HTTP 级）：2→3 添加成功；3→2 移出成功；2→1 返回 400「频道至少需要两个智能体」；设组长/清空组长成功；改 description 后重新 GET 仍在；新建 bot 出现在 state 的 `agents[]` 且可加入频道。
- 说明：CLI 的频道最少 2 人，**不存在 1 人频道**，所以「1→3」按「2→3」验证；2→1 是拒绝路径。

### 11.6 前端

- `ChannelMembersPopover`：组长卡片（可取消组长）+ 成员行；行 hover 出现「详情 / 设组长 / 静音 / 重启 / 移出」，移出在只剩 2 人时禁用并说明原因；底部「添加成员」「新建智能体」。
- 添加成员是面板内的第二屏：从名册里多选未在频道的 bot，顶部显示 `当前+已选/上限`、还能添加多少；满了或超限时禁用并说明。
- `AgentDetailDialog`：name/title/description 可编辑，显示 model/permissionMode/homeCwd；description 明说「会注入系统提示词，保存后对之后的新回复生效」；有 dirty 标记与关闭前确认。
- `NewAgentDialog`：name/title/description/model（模型复用 chat store 的 `/api/models` 目录），可勾选「创建后加入当前频道」；频道已满时自动取消勾选并说明。
- 历史消息的发言人/`@` 名称改用整份名册解析：移出成员后，它过去发的消息仍显示名字，不会变成「成员」。
- 截图钩子：`__wbl.openMembers()`、`__wbl.editAgent(id)`、`__wbl.addMember(id)`（打开添加面板并预选该 bot）。
- 只读降级：`canManage` 为 false 时隐藏详情/设组长/移出/新建入口，保留静音与重启。

### 11.7 验证

- `frontend npm run build` 通过；新增文件 `oxlint` 0 warning。
- `bin/workbuddy-lite.verify.exe` 编译通过；未覆盖用户正在运行的 `bin/workbuddy-lite.exe`。
- demo 截图（`bin/visual/`）：
  `v2-members-panel.png`、`v2-members-add.png`、`v2-members-agent-edit.png`、
  `v2-members-agent-saved.png`、`v2-members-new-agent.png`、`v2-members-lead.png`、
  `v2-members-added.png`、`v2-members-removed.png`、`v2-members-dark.png`。
- 回归：`bin/visual/regression-v2/{chat,workbench,empty}.png` 与 `v2-members-market.png`，会话/工作台/空态/插件市场均正常。

### 11.8 未做 / 风险

- **真实写操作仍未联调**：成员/组长/新建/改人设只对 demo 与 404 探针验证过；真实 `agent-home` 上会改用户数据，本轮没有执行。真实返回的字段完整性、`expectedRevision` 冲突频率、超时后的实际落盘状态都按「未验证」处理。
- **hidden 成员**：校验依赖 `/api/team/state` 的 `agents[]`，它不含 hidden bot；若真实频道里有 hidden 成员，任何成员替换都会被「成员必须在智能体名册里」拒绝。当前用户的频道没有这种情况，但这是已知边界。
- **组长能力**：服务端还会校验该 bot 是否有 lead capability；失败时返回的英文 message 与「必须是成员」相同，壳统一提示「组长必须是频道成员」，可能不够精确。
- **并发编辑**：壳会带 `expectedRevision`，预期能拿到 409 并提示重试；本轮没有和网页端同时操作验证过。
- **不支持的编辑**：详情页不改 model/permissionMode/homeCwd/avatar；不做删除 bot；不编辑 `systemPrompt` 的 append/replace；不做任务板。
- **demo 的 revision 是模拟值**：只用于前端合并，不与真实服务端语义完全等价。

---

## 12. v2 第二波：未读持久化 + 消息引用/跳转（2026-11-18）

### 12.1 CLI 能力复核（源码级 + 404 探针，未写真实频道）

| 能力 | 结论 | 证据 |
|---|---|---|
| 未读**写** | **支持**：`PATCH /api/v1/agent-home/channels/{id}`，body `{unreadByUser: number, unreadIf?: number}` | `applyUnreadPatch()`；`unreadIf` 是 CAS 保护：只有当前值等于它时才清零 |
| 未读**自增** | **不支持**：`--serve` 路径从不自增 | `bumpUnread()` 在两个 bundle 里都只有定义、无调用；web-ui 也只调 `clearChannel*Unreads` 清零 |
| 消息引用字段 | **支持**：消息模型有 `replyTo`，是原消息 id | `channels/*.jsonl` 文档字段；真实 218 条历史里暂未出现（用户还没用过） |
| 发送时带引用 | **支持**：`POST /channels/{id}/messages` body `{text, mentionAgentIds?, replyTo?}` | `resolveReplyTarget()` 接受完整 id 或唯一前缀（可带 `#`）；解析不到返回 `replyToDropped:true`，消息照常落库 |
| 路由探针 | `PATCH /channels/__probe__` 与 `POST /channels/__probe__/messages` 均 404 `CHANNEL_NOT_FOUND` | 只对不存在的 id 发请求，未写用户数据 |

结论：**未读计数必须由壳计算**（CLI 只会被显式设置/清零）；**引用可以真做**，不需要自造一套只在本壳可见的标注。

### 12.2 未读策略（本地游标 + CLI 镜像，不相加）

读游标存在**现有** `ui-state.json` 的 `teamRead` 下，按 `channelId` 记录最后已读消息时间：

```jsonc
{ "teamRead": { "<channelId>": { "at": 1794961090000 } } }
```

- **未读数** = 游标之后、`from != "user"` 的消息数；**没有游标时**（首次升级/首次运行）沿用 CLI 的 `unreadByUser` 作为迁移初值。两种来源**取其一，绝不相加**，否则侧栏会出现 41+3 这类双倍数字。
- **扫描**：前端每 4s 调 `GET /api/team/unread`，后端顺带做增量扫描——首次读整页（最多 218 条）回填离线期间的新消息，之后只走 `messages/page?after=`；单频道 pending 上限 500 条。
- **清零时机**：打开频道、滚到底、窗口重新获得焦点且停在底部、点击「N 条新消息」、离开频道。全部走 `POST /api/team/read`，推进游标并落盘。
- **回写 CLI**：仅在缓存的 `unreadByUser > 0` 时发一次 `PATCH {unreadByUser:0}`，让网页端/桌面端不再看到过期红点；失败不影响本地游标。
- **界面**：打开中的频道侧栏不显示红点；不在底部或窗口失焦时，新消息累计到「N 条新消息 ↓」浮条，点击瞬时滚到底并清零；向上翻页保持滚动位置，靠近顶部自动续页，另有「回到最新」。
- 已知上限：单次启动回填只读一页（218 条），若离线未读超过一页，数字按一页封顶；CLI 的 `unreadByUser` 不参与增量计算。

### 12.3 引用与跳转

- 发送：消息行 hover 出现引用按钮 → 输入区显示「引用 作者：正文」条 → `send` 带 `replyTo`；失败时引用目标随文字一起保留。
- 渲染：气泡上方显示引用块（左侧竖线 + 作者 + 单行截断正文）；目标不在当前分页时显示「原消息不在当前视图」，不可点。
- 跳转：点击引用块 → 若目标未加载，自动 `loadMore()` 最多 5 页 → `scrollIntoView({block:'center'})` → 气泡加 1.8s 描边高亮。
- 不做（本轮）：编辑、撤回、固定、附件；引用只在真实 `replyTo` 上实现，不伪造本地标注。

### 12.4 接口

| 方法 | 路径 | 入参 | 返回 |
|---|---|---|---|
| GET | `/api/team/unread` | – | `{enabled, channels:[{id, unread}], total}` |
| POST | `/api/team/read` | `{channelId}` | `{ok, unread:0}` |
| POST | `/api/team/send` | 新增 `replyTo?: string` | `{ok, message:{…, replyTo?}, warning?}` |

`GET /api/team/state` 新增 `canRead: true`；旧 exe 没有该字段时前端只做本地清零，不调用 `/api/team/read`。

### 12.5 验证（demo，未写真实频道）

- `frontend npm run build` 通过；`bin/workbuddy-lite.verify.exe` 编译通过；新改文件 `oxlint` 0 warning。
- HTTP 级：demo-1 初始 `unread=3` → `/api/team/read` 后 0；同数据目录重启仍 0；连发两条（每条触发 3 条 demo 回复）后 `unread=6`；带合法 `replyTo` 的消息原样返回，非法 id 被丢弃。
- 截图（`bin/visual/`）：`v2-unread-sidebar.png`（侧栏 3）、`v2-unread-channel.png`（引用块 + 红点已清）、`v2-unread-float.png`（滚上去后 3 条新消息）、`v2-unread-blur.png`（窗口失焦时也计入未读）、`v2-unread-jump.png`（跳转高亮）、`v2-unread-latest.png`（点击浮条回到底部）、`v2-unread-dark.png`（深色引用块）、`v2-unread-market.png`。
- 回归：`bin/visual/regression-v2b/{chat,workbench,empty}.png`。

### 12.6 风险

- **CLI 不自增未读**：如果用户同时开着网页端，网页端不会把「新消息」写进 `unreadByUser`，两边数字可能不同；壳以本地游标为准。
- **回写是尽力而为**：`PATCH` 失败只影响其他客户端的红点，不影响壳；没有重试。
- **首次回填只读一页**：离线未读超过 218 条时，数字按一页封顶（不会错乱，只会偏小）。
- **引用目标可能已被撤回/删除**：渲染为「原消息不在当前视图」，不阻塞发送。
- **demo 时间锚定到当天零点**：同一自然日内重启不会冲掉已读；跨天后 demo 消息整体前移一天，会重新出现未读（仅影响 demo）。

---

## 13. 团队工具（MCP）（2026-11-18）

把频道 / 成员 / 人设 / 发消息暴露成 MCP 工具，让 agent 在普通聊天里用一句话完成团队操作。
工具只做「翻译 + 参数校验」，业务校验全部落到既有 `/api/team/*`，没有第二套逻辑。

### 13.1 接入方式（per-session，不改全局 mcp.json）

- `src/mcp_team.cpp` 实现 stdio MCP server，入口是 `workbuddy-lite.exe --mcp-team`。
  这个开关在 `wWinMain` 第一行分流，早于 DPI / GDI+ / WebView 初始化，所以子进程不会弹窗。
- `Backend::teamMcpServers()` 在 `session/new` 和 `session/load` 的 `mcpServers` 里注入：
  本 exe + `--mcp-team`，env 带 `WBL_TEAM_PORT`（当前本地服务端口）与 `WBL_TEAM_DATA`（数据目录）。
  **不写用户全局 `mcp.json`**，CLI 里手工开的会话不受影响；会话结束进程即退出。
- 服务端条目只写 `name / command / args / env`，**不写 `type`**：CLI 的
  `convertAcpMcpServersToDynamic` 见到 `type` 只认 http/sse，stdio 条目会被整条跳过。
- 端口解析：`WBL_TEAM_PORT` 优先，其次读数据目录的 `port.txt`（壳启动时写，与 `localAppDir()` 同源）。
  每次工具调用重新解析，壳重启换了端口也能跟上；找不到端口时工具返回可读错误而不是崩溃。
- demo 会话、AI 整理临时会话不注入（前者没有 agent，后者只需要总结文本）。

### 13.2 工具表（8 个）

所有工具都在 stdout 上按「一行一帧 JSON-RPC」收发，诊断信息走 stderr（`[mcp-team] …`）。
协议版本 `2024-11-05`；`initialize` 里带 `instructions`，说明「写操作会直接改用户数据，执行前先确认」。

| 工具 | 参数 | 返回 | 副作用 |
|---|---|---|---|
| `team_list` | – | 文本：频道（id / 成员数 / 组长 / 最近一条）+ 名册（id / 角色） | 只读 |
| `team_create_channel` | `name`, `memberAgentIds[]` | `{ok, channel}` | 建频道；≥2 人、≤上限、成员须在名册、排除默认分身 |
| `team_add_members` | `channelId`, `agentIds[]` | `{ok, channel}` | 读现状 → 全量 PATCH，带 `expectedRevision`；已存在则「没有改动」 |
| `team_remove_members` | `channelId`, `agentIds[]` | `{ok, channel}` | 同上；移出后 <2 人被拒 |
| `team_set_lead` | `channelId`, `agentId \| null` | `{ok, channel}` | 设/撤组长；非成员被拒 |
| `team_create_agent` | `name`, `title`, `description`, `model?` | `{ok, agent}` | 新建 bot；重名被拒 |
| `team_update_agent_prompt` | `agentId`, `title?`, `description?` | `{ok, agent}` | 改角色/人设；至少一个字段，保存后对新回复生效 |
| `team_send_message` | `channelId`, `text`, `mentionAgentIds?` | `{ok, message, warning?}` | 以用户身份落消息；@ 会唤醒成员并计费 |

行为约定：

- **执行失败用 `isError: true` 的文本结果**，不是 JSON-RPC error：模型能看到原因（「频道至少需要两个智能体」
  「组长必须是频道成员」）并自行改正。只有「未知工具 / 参数不是对象」这类协议问题才回 `-32602`。
- 成功时把 `/api/team/*` 的 JSON 原文放进 content，模型据此拿到新 `channelId` / `agentId`。
- 超时：读 10s、写 20s、建频道 30s；`team_send_message` 遇到壳的「已发送但回复稍后到」时把 `warning` 一并回给模型。
- 不做删除频道 / 删除 bot：底层没有对应接口，不在这里造。

### 13.3 启用与关闭

- **启用**：普通聊天会话自动带，无需配置，也没有前端开关（这一波只给 agent 用）。
- **关闭**：per-session 注入 —— 关掉会话或退出应用，MCP 进程随 stdin 关闭退出，能力自然消失。
  不写全局 `mcp.json`，所以不会污染 `codebuddy` 命令行会话。
- **不希望暴露**：用 `--demo` 启动（demo 不注入），或直接不启动壳。
- **手工接**（调试用）：`codebuddy -p "…" --mcp-config <cfg> --strict-mcp-config`，`cfg` 里
  `{"mcpServers":{"team":{"command":"…/workbuddy-lite.exe","args":["--mcp-team"],"env":[…]}}}`。

### 13.4 权限与风险

- 工具代表**用户本人**读写团队数据，写操作没有二次确认；模型误判一句话就能建群、拉人、发消息。
  提示词里已要求「写操作前先确认」，但这只是软约束。
- `team_send_message` 带 `mentionAgentIds` 时，每个被叫成员都是一次完整 agent run，**会消耗额度**；
  不传只落消息不唤醒。
- 本地服务只监听 `127.0.0.1`，MCP server 本身无鉴权：能写它 stdin 的父进程（也就是 CLI）可以执行全部工具；
  这也是 MCP stdio 的通用模型，不额外加 token。
- 工具不做删除；改人设会影响该 bot 之后的所有回复，历史消息不变。

### 13.5 验证（2026-11-18）

- 编译：`build.bat` 的源文件列表已加 `src/mcp_team.cpp`；本轮因 `bin/workbuddy-lite.verify.exe`
  被运行中的 demo 实例占用，改用同参数、不同输出名的产物验证编译，未覆盖也未结束任何用户进程。
- **JSON-RPC（demo 数据目录）**：`initialize` → `tools/list` → `tools/call team_list` 通过；
  8 个工具齐全，`team_list` 返回的频道 / 成员与 fixture 完全一致（`demo-1`、`demo-agent-review` 等）。
  另跑 24 项断言：建频道 → 加成员 → 重复加人（无改动）→ 设组长 → 非成员当组长被拒 → 改人设（列表已生效）
  → 新建 bot → 发消息（含 @）→ 移出成员 → 少于 2 人被拒 → 撤组长 → 缺参/空串/类型错误被拒 →
  未知工具 `-32602` → 未知方法 `-32601`，全部通过；坏 JSON 回 `-32700` 后仍能继续处理后续帧。
- **真实模型（ACP 路径，和壳内完全同一条）**：起一个独立 `codebuddy --serve`，`session/new` 带
  `mcpServers` 注入本 exe，模型一轮内命中 `mcp__team__team_list`，回答里的 `demo-1` / `demo-2` /
  成员名与 fixture 一致（不是编造）；`session/load` 带同样 `mcpServers` 恢复会话后工具仍在。
- **真实模型写操作（仅 demo 数据）**：一句话「在 demo-c-… 发一条…」→ 模型调用
  `mcp__team__team_send_message` → 返回 `{"ok":true,"message":{...}}`，随后 `GET /api/team/messages` 能读到该条。
- **未验证**：真实（非 demo）团队数据上的写操作。按约定本轮不碰用户真实频道；MCP 侧的参数校验与壳路由
  是同一套，但真实服务端的字段完整性、`expectedRevision` 冲突频率仍属「未验证」。
- **本轮修的问题**：建频道原先只校验人数，不校验 id 是否在名册里；CLI 会静默剔除陌生 id，
  可能「建成功但只剩 1 人」。已在 `handleTeamCreate` 补上与 `/channel/members` 相同的名册校验
  （同一句提示「成员必须在智能体名册里，请刷新后重试」），MCP 与前端共用，不再各写一份。
