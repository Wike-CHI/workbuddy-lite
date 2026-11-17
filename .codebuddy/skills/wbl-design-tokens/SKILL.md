---
name: wbl-design-tokens
description: "workbuddy-lite 前端的设计 token 使用规则：颜色、圆角、字号、阴影、动效都以 frontend/src/index.css 与 docs/design-system.md 为准。写或改 frontend/src 下任何样式、需要确认某个 Tailwind 类是否存在、要加深色适配、或要新增状态色时使用。"
---

# 前端设计 token 使用

界面只有一套表面层级和一个强调色。颜色写错不会报错，只会在深色模式或另一块面板里露馅，
所以改样式前先确认 token 真的存在。

## 先读这两个文件

| 文件 | 看什么 |
|---|---|
| `frontend/src/index.css` | `:root` 与 `.dark` 的变量定义（1–96 行）、`@theme inline` 的 Tailwind 映射（97–141 行） |
| `docs/design-system.md` | 层级约定、组件职责、字号与动效规则 |

规则以文件为准，本文只是索引。发现本文和文件不一致时，按文件来，并回报这处不一致。

## 真实可用的类

`@theme inline` 里定义了 `--color-*` 的才有对应 Tailwind 类：

- 表面：`bg-background`、`bg-card`、`bg-popover`、`bg-surface-2`、`bg-surface-3`、`bg-sidebar`
- 文字：`text-foreground`、`text-muted-foreground`、`text-ink`、`text-ink-2`、`text-ink-3`、`text-ink-4`、`text-sidebar-foreground`
- 线：`border-border`、`border-input`、`border-sidebar-border`
- 强调：`bg-accent`（注意映射到 `--accent-soft`，不是主色）、`text-accent-foreground`、`bg-primary`、`text-primary-foreground`
- 语义：`text-ok` / `bg-ok-soft`、`text-warning` / `bg-warning-soft`、`text-err` / `bg-err-soft`、`text-destructive`
- 圆角：`rounded-sm`(4) / `rounded-md`(6) / `rounded-lg`(8) / `rounded-xl`(12)

**已知坑：`bg-surface` 没有映射。** `--surface` 定义在 `:root` 里，但 `@theme inline` 只映射了
`surface-2` / `surface-3`，所以 `bg-surface` 不生成任何样式。要浅一层的面板用 `bg-card`，
再深一层用 `bg-surface-2`。改到这里时应顺手确认：类名是否真的出现在 `@theme inline` 里。

**主色不是 `bg-accent`。** `--color-accent` 映射的是 `--accent-soft`（浅紫底），
主色按钮用 `bg-primary`，链接和强调文字用 `text-accent-foreground` 或 `text-primary`。
写错的表现是按钮变成浅紫色底 + 白字，对比度极低。

## 工作原则

- **不新增 hex、rgb、oklch 字面量。** 现有组件已经清过一轮硬编码颜色（`2e9fe03 feat(ui): redesign shell...`），
  退回去会让深色模式再次失效。确实需要新颜色时，先在 `:root` 和 `.dark` 各加一个变量，
  再在 `@theme inline` 映射，最后才在组件里用——三步缺一不可。
- **语义色只表达状态。** `ok/warn/err` 用于成功、警告、失败；不要拿 `text-err` 当装饰色，
  否则用户无法从颜色判断状态。
- **字号有下限。** 正文 13.5px，UI 12.5px，meta 10.5–11px，代码 12–12.5px。不要用 `text-[10px]` 放正文。
  理由：开发者长时间盯屏，10px 正文在这个窗口尺寸下不可读。
- **圆角跟层级走。** 卡片 8（`rounded-lg`），composer 12（`rounded-xl`），按钮 6（`rounded-md`）。
  同一屏里不要出现三种以上圆角。
- **阴影只给浮层。** 只有 popover / toast 用 `shadow-[var(--shadow-pop)]`；主界面靠 `border-border` 与
  `bg-*` 分层，不加卡片阴影。
- **动效 120–160ms。** 用 `transition-colors` / `duration-150`；不做位移动画，
  运行中状态用脉冲点（`animate-pulse`）而不是彩色胶囊。
- **深色模式只靠变量覆盖。** 组件里不写 `dark:bg-[#...]`；`.dark` 已经覆盖同名变量，
  写死颜色会把两套主题撕开。

## 新增一个状态色的流程

1. 判断能不能复用 `ok/warn/err`；能复用就不要新增。
2. 在 `:root` 加 `--xxx` 与 `--xxx-soft`，在 `.dark` 加同名覆盖值。
3. 在 `@theme inline` 加 `--color-xxx: var(--xxx)`。
4. 组件里用 `text-xxx` / `bg-xxx-soft`。
5. 深浅色各截一张图确认对比度（`wbl-visual-check`）。

## 检查清单

- [ ] 新增/修改的类都能在 `@theme inline` 里找到对应 `--color-*`。
- [ ] 没有新增颜色字面量；没有 `dark:` 前缀下的硬编码颜色。
- [ ] 字号、圆角、阴影符合上面的档位。
- [ ] 浅色与深色各看过一次截图。
- [ ] 如果改了 token 本身，`docs/design-system.md` 的 token 表同步更新。
