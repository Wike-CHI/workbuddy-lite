# workbuddy-lite

把本机 codebuddy CLI 包成 Windows 桌面客户端：C++17（httplib + ACP + WebView2）在后，React 19 在前。

## 开发编排

**目标：** 这个仓库的功能开发走一条固定的「调研 → 后端 → 前端 → 构建 → 截图验收 → 提交」链，
每步产出都能被下一步直接使用。

**调用条件：** 在本仓库里提出新功能、改交互、修界面问题、给插件市场/会话/工作台加能力时，
使用 `wbl-feature` 技能编排。后续返工（接着上次改、只改样式、只调文案、验收没过要返工）也用它。
单纯问代码在哪、解释实现、查文档，直接回答即可。

**单独调用：** 只跑构建用 `wbl-build`；只做界面截图用 `wbl-visual-check`；写样式前查 token 用
`wbl-design-tokens`。

**变更记录：**

| 日期 | 变更内容 | 对象 | 原因 |
| --- | --- | --- | --- |
| 2026-11-17 | 首次按 Harness v2 搭建：4 个 agent、4 个 skill、编排技能 | `.codebuddy/` | 把仓库既有的构建、截图、token 约束固化成可复用工作流 |
| 2026-11-17 | 构建说明补充「应用更新编到 next」 | `.codebuddy/skills/wbl-build/SKILL.md` | 自更新流程需要避开正在运行的 exe |
