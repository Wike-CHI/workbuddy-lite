#!/usr/bin/env node
// WorkBuddy Lite 的浏览器工具：让 agent（或人）用命令行操作右栏那个内嵌浏览器。
// 用法：
//   node tools/browser.mjs open https://example.com
//   node tools/browser.mjs state
//   node tools/browser.mjs click "button.login"
//   node tools/browser.mjs type "#q" "hello"
//   node tools/browser.mjs press Enter
//   node tools/browser.mjs eval "document.title"
//   node tools/browser.mjs shot [out.png]
//   node tools/browser.mjs import-chrome
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

function findPort() {
  const env = process.env.WBL_PORT
  if (env) return Number(env)
  const flag = process.argv.find((a) => a.startsWith('--port='))
  if (flag) return Number(flag.slice('--port='.length))

  const candidates = [
    path.resolve(here, '..', 'bin', 'data', 'port.txt'),
    path.join(process.env.LOCALAPPDATA || '', 'WorkBuddyLite', 'port.txt'),
    path.join(os.homedir(), 'AppData', 'Local', 'WorkBuddyLite', 'port.txt'),
  ]
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8').trim()
      if (/^\d+$/.test(raw)) return Number(raw)
    } catch {
      // 继续找下一个
    }
  }
  return 0
}

const port = findPort()
if (!port) {
  console.error('找不到 WorkBuddy Lite 的端口：请先启动应用，或用 --port= 指定')
  process.exit(1)
}
const base = `http://127.0.0.1:${port}`

async function request(pathname, init) {
  const res = await fetch(base + pathname, init)
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    console.error(JSON.stringify(json, null, 2))
    process.exit(1)
  }
  return json
}

function body(data) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }
}

function jsString(value) {
  return JSON.stringify(value)
}

async function main() {
  const [command, ...args] = process.argv.slice(2).filter((a) => !a.startsWith('--port='))

  switch (command) {
    case 'open':
    case 'goto': {
      if (!args[0]) throw new Error('用法：browser.mjs open <url>')
      const url = /^https?:\/\//i.test(args[0]) ? args[0] : 'http://' + args[0]
      console.log(JSON.stringify(await request('/api/browser/navigate', body({ url }))))
      break
    }
    case 'state': {
      const out = await request('/api/browser/state')
      console.log(JSON.stringify(out.state || {}, null, 2))
      break
    }
    case 'text': {
      const out = await request('/api/browser/state')
      console.log(out.state?.text || '')
      break
    }
    case 'eval': {
      if (!args[0]) throw new Error('用法：browser.mjs eval "<js>"')
      const out = await request('/api/browser/eval', body({ script: args[0] }))
      console.log(JSON.stringify(out.result, null, 2))
      break
    }
    case 'click': {
      if (!args[0]) throw new Error('用法：browser.mjs click "<selector>"')
      const script = `(() => {
        const el = document.querySelector(${jsString(args[0])});
        if (!el) return { ok: false, error: 'selector not found' };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { ok: true, tag: el.tagName, text: (el.innerText || '').slice(0, 80) };
      })()`.replace(/\n\s*/g, ' ')
      const out = await request('/api/browser/eval', body({ script }))
      console.log(JSON.stringify(out.result, null, 2))
      break
    }
    case 'type': {
      if (!args[0] || args[1] === undefined) throw new Error('用法：browser.mjs type "<selector>" "<text>"')
      const script = `(() => {
        const el = document.querySelector(${jsString(args[0])});
        if (!el) return { ok: false, error: 'selector not found' };
        el.scrollIntoView({ block: 'center' });
        el.focus();
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, ${jsString(args[1])});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: el.value };
      })()`.replace(/\n\s*/g, ' ')
      const out = await request('/api/browser/eval', body({ script }))
      console.log(JSON.stringify(out.result, null, 2))
      break
    }
    case 'press': {
      const key = args[0] || 'Enter'
      const script = `(() => {
        const el = document.activeElement || document.body;
        for (const type of ['keydown','keypress','keyup']) {
          el.dispatchEvent(new KeyboardEvent(type, { key: ${jsString(key)}, bubbles: true }));
        }
        return { ok: true, key: ${jsString(key)}, target: el.tagName };
      })()`.replace(/\n\s*/g, ' ')
      const out = await request('/api/browser/eval', body({ script }))
      console.log(JSON.stringify(out.result, null, 2))
      break
    }
    case 'shot': {
      const target = args[0] || ''
      const out = await request('/api/browser/shot' + (target ? `?path=${encodeURIComponent(target)}` : ''))
      console.log(JSON.stringify(out))
      break
    }
    case 'import-chrome': {
      console.log(JSON.stringify(await request('/api/browser/import', body({})), null, 2))
      break
    }
    default:
      console.error(`WorkBuddy Lite 浏览器工具

  node tools/browser.mjs open <url>              在右栏浏览器里打开
  node tools/browser.mjs state                   返回 {url,title,text}
  node tools/browser.mjs text                    只打印页面文字
  node tools/browser.mjs eval "<js>"             执行 JS 并返回结果
  node tools/browser.mjs click "<selector>"      点击元素
  node tools/browser.mjs type "<selector>" "<t>" 填入文本
  node tools/browser.mjs press Enter             按键
  node tools/browser.mjs shot [out.png]          截图到文件
  node tools/browser.mjs import-chrome           导入本机 Chrome 登录态（要先退出 Chrome）

环境变量 WBL_PORT 或 --port= 可以指定端口；默认读 bin/data/port.txt。`)
      process.exit(command ? 1 : 0)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
