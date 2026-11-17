---
name: wbl-visual-check
description: "用 demo 模式启动 workbuddy-lite 并对真实窗口截图，再用 ViewImage 逐项目视检查界面是否错位、溢出、缺字、对比度不足或状态不对。任何 UI 改动验收、需要界面证据、或要确认某个面板在深浅色下是否正常时使用；只看构建日志或接口返回不算完成验收。"
---

# demo 截图验收

界面问题只有看图才能确认：构建通过、接口 200、日志写着 `capture ok`，都不能证明按钮没被裁掉、
深色模式下文字没糊在背景里。

## 命令

```bash
bash .codebuddy/skills/wbl-visual-check/scripts/shot.sh <名字> "<触发界面的 JS>" [等待毫秒]
```

展开后等价于：

```bash
WORKBUDDY_LITE_DATA=<临时目录> ./bin/workbuddy-lite.verify.exe \
  --demo --cwd <仓库根> --eval "<JS>" --wait 2400 --shot bin/visual/<名字>.png
```

- `--demo`：不登录、用演示数据，避免动到用户真实会话。
- `--cwd`：会话与工作空间落在被测仓库，截图里能看到真实文件名。
- `--eval`：在页面导航完成后约 0.9 秒执行一次脚本，用来打开面板、切主题、填入内容。
- `--wait`：执行 eval 之后再等多久才截图。默认 2400ms；需要等异步加载（市场、任务面板）时给 4000–6000。
- `--shot`：调用 WebView2 的 `CapturePreview` 存 PNG，然后关闭窗口退出。
- `WORKBUDDY_LITE_DATA` 指向独立目录，避免和用户实例共用 `sessions.json`。

脚本会优先用 `bin/workbuddy-lite.verify.exe`，没有时退回 `bin/workbuddy-lite.exe`。
截图统一落在 `bin/visual/`（`bin/` 已 gitignore，不会进版本库）。

## 可用的界面钩子

`frontend/src/App.tsx` 暴露了 `window.__wbl`，专供截图和自动化，正常使用不依赖：

| 钩子 | 作用 |
|---|---|
| `__wbl.openMarket()` | 打开能力弹窗，**默认停在「技能」tab** |
| `__wbl.openUsage()` | 打开积分/用量弹窗 |
| `__wbl.openWorkspace()` | 打开工作空间弹窗 |
| `__wbl.openWorkbench(tab)` | 打开右栏并切到 `files` / `diff` / `plan` / `todos` / `git` / `tasks` / `browser` |
| `__wbl.openIuiLibrary('saved'\|'templates')` | 打开智能 UI 库 |
| `__wbl.send(text)` | 以真实路径发一条消息（会消耗模型额度，验收尽量别用） |
| `__wbl.setComposerText(text)` | 只填输入框，不发送，用来截 `/`、`@` 弹层 |
| `__wbl.browse(url)` | 让右栏浏览器打开地址 |

**切 tab 要用 mousedown。** 弹窗里的 tab 是 Radix Tabs，靠 `mousedown` 激活，`element.click()` 不会切换
（实测：只 click 仍停在「技能」tab）。插件市场 tab 的 id 是 `market-tab-plugins`：

```js
setTimeout(function(){window.__wbl.openMarket()},300);
setTimeout(function(){
  var t=document.getElementById('market-tab-plugins');
  if(t){t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));t.focus();t.click()}
},1200);
```

需要「先打开面板、再点一下某个筛选」这类连续动作，用 `setTimeout` 串起来：

```js
setTimeout(function(){window.__wbl.openMarket()},300);
setTimeout(function(){var el=document.getElementById('market-category-dev');if(el)el.click()},900);
```

淡入、异步请求没结束时，宁可多加 `--wait`，不要用固定 sleep 赌时序。

## 视图检查清单

每次都要用 ViewImage 打开 PNG，逐条回答，不允许「看起来还行」：

1. **结构**：目标面板确实打开了；没有被别的弹窗盖住；不是空白页或错误页。
2. **裁切**：标题、按钮、表头没有被窗口边缘或滚动条切掉。
3. **重叠**：文字没有压在图标、徽标、分割线上；sticky 头部没有盖住第一行内容。
4. **字号**：正文 ≥13px，说明性文字 ≥10.5px；没有出现挤成一团的 10px 正文。
5. **对比**：次要文字在浅色/深色背景上都还能读；没有浅灰字压在浅灰底上。
6. **状态**：选中/悬停/禁用/运行中的样式能区分，而且是靠形状/色块而不是彩色胶囊。
7. **内容**：中文文案没有截断成「…」到无法理解；数字/单位/金额没有错位。
8. **空态**：列表为空时给的是明确说明，不是一片空白。
9. **主题**：改动涉及颜色时，浅色和深色各截一张（`.dark` 下变量会换值）。
10. **宽度**：1280px 主窗口 + 右栏展开时，顶栏和列表没有换行错乱。

## 常见问题

| 现象 | 处理 |
|---|---|
| 全黑 / 全白 | 先加 `--wait` 到 4000；再确认 `--eval` 里没有抛异常导致面板没开 |
| 只截到应用背景 | 面板打开是异步的，给 `--eval` 里的 `setTimeout` 留 600–900ms |
| 截图里出现演示数据标记 | 正常，`--demo` 会显示「演示数据」徽章，不算缺陷 |
| 同一路径截图被占用 | 换名字重截，不要删用户已有的 `bin/visual/*.png` |
| 需要整窗（含标题栏） | 用 `--winshot` 代替 `--shot` |

## 检查清单

- [ ] 截图文件存在且非 0 字节，路径写在报告里。
- [ ] 用 ViewImage 看过，10 条清单逐条有结论。
- [ ] 若改的是颜色/主题，浅色与深色各有一张。
- [ ] 没有为了截图去杀进程或占用用户的 `bin/data`。
