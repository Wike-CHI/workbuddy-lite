#!/usr/bin/env node
// 用隔离 venv 里的 browser-use 跑浏览器任务。
//   node tools/browser_use.mjs "任务" [--browser chrome|chromium] [--profile Work] [--max-steps 20]
//   node tools/browser_use.mjs --selftest
//
// 默认 Browser('chrome')：直接接管你已经打开的 Chrome，登录态复用。
// 需要先在 chrome://inspect/#remote-debugging 打开一次远程调试。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const home = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
const venv = path.join(home, 'WorkBuddyLite', 'browser-use', 'venv')
const python = path.join(venv, 'Scripts', 'python.exe')
const driver = path.join(here, 'browser_use_agent.py')

if (!fs.existsSync(python)) {
  console.error(
    `还没装 browser-use 环境：${venv}\n` +
      '先执行：\n' +
      '  uv venv "%LOCALAPPDATA%\\WorkBuddyLite\\browser-use\\venv" --python 3.12\n' +
      '  uv pip install --python "%LOCALAPPDATA%\\WorkBuddyLite\\browser-use\\venv\\Scripts\\python.exe" "browser-use==1.0.5"',
  )
  process.exit(1)
}

const args = process.argv.slice(2)
const result = spawnSync(python, [driver, ...args], { stdio: 'inherit', env: process.env })
process.exit(result.status ?? 1)
