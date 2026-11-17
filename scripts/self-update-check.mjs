#!/usr/bin/env node
// 自更新端到端检查：全部在系统临时目录里跑，不碰用户正在使用的 bin/workbuddy-lite.exe。
//   node scripts/self-update-check.mjs
// 覆盖：编译产物替换 + 重启、next 缺失 409、updater 等待超时、替换失败回滚。
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcExe = path.join(root, 'bin', 'workbuddy-lite.verify.exe')
const srcUpdater = path.join(root, 'bin', 'workbuddy-updater.exe')
for (const file of [srcExe, srcUpdater]) {
  if (!fs.existsSync(file)) {
    console.error('缺少构建产物：' + file + '，先跑 build-verify.sh')
    process.exit(1)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbl-selfupdate-'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
let failed = 0

function check(name, ok, detail = '') {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed += 1
}

async function http(port, pathname, init) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(4000),
  })
  const text = await res.text()
  let body = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }
  return { status: res.status, body }
}

async function waitForPort(dataDir, timeoutMs = 30000, ready) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const port = Number(fs.readFileSync(path.join(dataDir, 'port.txt'), 'utf8').trim())
      if (port) {
        const ping = await http(port, '/api/ping')
        if (ping.status === 200 && (!ready || (await ready(port)))) return port
      }
    } catch {
      // 还没写出来
    }
    await sleep(250)
  }
  throw new Error('等待端口超时：' + dataDir)
}

function waitForExit(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve({ code: child.exitCode })
    const timer = setTimeout(() => reject(new Error('等待进程退出超时')), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

function startApp(dir, dataDir, extra = []) {
  return spawn(path.join(dir, 'workbuddy-lite.exe'), ['--demo', '--cwd', root, ...extra], {
    env: { ...process.env, WORKBUDDY_LITE_DATA: dataDir },
    stdio: 'ignore',
    windowsHide: false,
  })
}

// ---------- 1. 正常替换：旧 PID 退出、新 PID 起来、状态还在 ----------
console.log('\n== 替换并重启 ==')
const appDir = path.join(tmp, 'app')
const dataDir = path.join(appDir, 'data')
fs.mkdirSync(dataDir, { recursive: true })
fs.copyFileSync(srcExe, path.join(appDir, 'workbuddy-lite.exe'))
fs.copyFileSync(srcExe, path.join(appDir, 'workbuddy-lite.next.exe'))
fs.copyFileSync(srcUpdater, path.join(appDir, 'workbuddy-updater.exe'))

const oldHash = sha(path.join(appDir, 'workbuddy-lite.exe'))
const stagedHash = sha(path.join(appDir, 'workbuddy-lite.next.exe'))
const old = startApp(appDir, dataDir)
const oldPid = old.pid
let port = await waitForPort(dataDir)
const boot = await http(port, '/api/bootstrap')
check('旧实例启动', boot.status === 200 && boot.body.pid === oldPid, `pid=${oldPid} port=${port}`)
check('updateReady=true', (await http(port, '/api/app/update')).body.updateReady === true)

const team = await http(port, '/api/team/state')
const channelId = team.body.channels?.[0]?.id || ''
const created = await http(port, '/api/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})
const sessionId = created.body.session?.id || ''
await http(port, '/api/app/ui', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    activeSessionId: sessionId,
    activeChannelId: channelId,
    chat: { model: 'glm-5.3', mode: 'fullAccess', thought: 'enabled', config: {} },
    workbench: { open: true, width: 420, tab: 'tasks' },
  }),
})
const afterUi = await http(port, '/api/bootstrap')
check('activeSessionId 已落到 lastSessionId', afterUi.body.lastSessionId === sessionId, sessionId)
check('演示频道可用', !!channelId, channelId)

const restart = await http(port, '/api/app/restart', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})
check('POST /api/app/restart -> 202', restart.status === 202, JSON.stringify(restart.body))

const exit = await waitForExit(old, 30000)
check('旧 PID 退出', exit.code === 0, `pid=${oldPid} code=${exit.code}`)

const newPort = await waitForPort(dataDir, 30000, async (candidate) => {
  const b = await http(candidate, '/api/bootstrap')
  return b.status === 200 && b.body.pid && b.body.pid !== oldPid
})
const newBoot = await http(newPort, '/api/bootstrap')
const newPid = newBoot.body.pid
check('新 PID 起来且不同', !!newPid && newPid !== oldPid, `${oldPid} -> ${newPid}`)
check('/api/models 200', (await http(newPort, '/api/models')).status === 200)
check('新进程仍是 demo', newBoot.status === 200 && newBoot.body.demo === true)
check('lastSessionId 恢复', newBoot.body.lastSessionId === sessionId, newBoot.body.lastSessionId)

const ui = await http(newPort, '/api/app/ui')
check('activeChannelId 恢复', ui.body.activeChannelId === channelId, ui.body.activeChannelId)
check('模型/effort 恢复', ui.body.chat?.model === 'glm-5.3' && ui.body.chat?.thought === 'enabled')
check('工作台开合恢复', ui.body.workbench?.open === true && ui.body.workbench?.tab === 'tasks')

const log = fs.readFileSync(path.join(appDir, 'updater.log'), 'utf8')
check('日志有替换记录', log.includes('next -> target 完成') && log.includes('新进程已启动'))
check('exe 已被替换', sha(path.join(appDir, 'workbuddy-lite.exe')) === stagedHash, `old=${oldHash.slice(0, 8)}`)
check('next 已消费', !fs.existsSync(path.join(appDir, 'workbuddy-lite.next.exe')))

// ---------- 2. next 不存在：409，主进程不退出 ----------
console.log('\n== next 缺失 ==')
const missing = await http(newPort, '/api/app/restart', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})
check('next 缺失 -> 409', missing.status === 409, missing.body.error || '')
await sleep(1500)
const alive = await http(newPort, '/api/ping')
check('主进程没有退出', alive.status === 200)
const stillSame = await http(newPort, '/api/bootstrap')
check('PID 未变化', stillSame.body.pid === newPid, String(stillSame.body.pid))

// 收掉测试实例（只杀本脚本启动的临时副本）
spawnSync('taskkill', ['/PID', String(newPid), '/T', '/F'], { stdio: 'ignore' })

// ---------- 3. updater 独立替换 ----------
console.log('\n== updater 独立替换 ==')
const swapDir = path.join(tmp, 'swap')
fs.mkdirSync(swapDir, { recursive: true })
const swapTarget = path.join(swapDir, 'app.exe')
const swapNext = path.join(swapDir, 'app.next.exe')
fs.copyFileSync(srcUpdater, swapTarget)
fs.copyFileSync(srcUpdater, swapNext)
fs.writeFileSync(swapNext, Buffer.concat([fs.readFileSync(swapNext), Buffer.from('next-marker')]))
const nextHash = sha(swapNext)

const exited = spawn('cmd.exe', ['/c', 'exit', '0'], { stdio: 'ignore' })
await waitForExit(exited, 5000)
const swap = spawnSync(
  srcUpdater,
  ['--pid', String(exited.pid), '--next', swapNext, '--target', swapTarget, '--timeout', '5', '--'],
  { stdio: 'ignore', timeout: 20000 },
)
check('updater 替换成功', swap.status === 0, `exit=${swap.status}`)
check('target 内容 = next', sha(swapTarget) === nextHash)
check('next 已消费', !fs.existsSync(swapNext))
check('替换日志存在', fs.readFileSync(path.join(swapDir, 'updater.log'), 'utf8').includes('完成'))

// ---------- 4. updater 等待超时：只写日志，不动文件 ----------
console.log('\n== updater 等待超时 ==')
const timeoutDir = path.join(tmp, 'timeout')
fs.mkdirSync(timeoutDir, { recursive: true })
const tTarget = path.join(timeoutDir, 'app.exe')
const tNext = path.join(timeoutDir, 'app.next.exe')
fs.copyFileSync(srcUpdater, tTarget)
fs.copyFileSync(srcUpdater, tNext)
const targetHash = sha(tTarget)
const waitTimeout = spawnSync(
  srcUpdater,
  ['--pid', String(process.pid), '--next', tNext, '--target', tTarget, '--timeout', '1', '--'],
  { stdio: 'ignore', timeout: 15000 },
)
const timeoutLog = fs.readFileSync(path.join(timeoutDir, 'updater.log'), 'utf8')
check('超时退出码 2', waitTimeout.status === 2, `exit=${waitTimeout.status}`)
check('超时只写日志', timeoutLog.includes('超时'))
check('target 未变', sha(tTarget) === targetHash)
check('next 仍在', fs.existsSync(tNext))

// ---------- 5. 替换失败回滚 ----------
console.log('\n== 替换失败回滚 ==')
const rollbackDir = path.join(tmp, 'rollback')
fs.mkdirSync(rollbackDir, { recursive: true })
const rTarget = path.join(rollbackDir, 'app.exe')
const rNext = path.join(rollbackDir, 'app.next.exe')
fs.copyFileSync(srcUpdater, rTarget)
fs.copyFileSync(srcUpdater, rNext)
const originalHash = sha(rTarget)

// 用 FileShare.None 锁住 next，让 MoveFileEx 失败；updater 应回滚 target 并退出 5
const locker = spawn(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `$f=[System.IO.File]::Open('${rNext.replace(/'/g, "''")}','Open','Read','None'); Start-Sleep -Seconds 14; $f.Close()`,
  ],
  { stdio: 'ignore', windowsHide: true },
)
await sleep(1200)
const rollback = spawnSync(
  srcUpdater,
  ['--pid', String(exited.pid), '--next', rNext, '--target', rTarget, '--timeout', '5', '--'],
  { stdio: 'ignore', timeout: 30000 },
)
locker.kill()
check('替换失败退出码 5', rollback.status === 5, `exit=${rollback.status}`)
check('回滚后 target 仍在且内容未变', fs.existsSync(rTarget) && sha(rTarget) === originalHash)
const rollbackLog = fs.readFileSync(path.join(rollbackDir, 'updater.log'), 'utf8')
check('日志记录回滚', rollbackLog.includes('回滚'))

console.log('\n临时目录：' + tmp)
if (failed) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
