#!/usr/bin/env node
// 最小可维护的视觉回归：用 fixture 数据跑一次桌面端，抓几张关键状态。
//   node scripts/visual-check.mjs [--out bin/visual]
// 依赖：先 npm run build（frontend）与 build.bat，产出 bin/workbuddy-lite.exe。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exe = path.join(root, 'bin', 'workbuddy-lite.exe')
const outIndex = process.argv.indexOf('--out')
const outDir = path.resolve(root, outIndex > 0 ? process.argv[outIndex + 1] : 'bin/visual')

if (!fs.existsSync(exe)) {
  console.error('找不到 bin/workbuddy-lite.exe，先跑 build.bat')
  process.exit(1)
}

const dataDir = path.join(root, 'bin', 'data-visual')
fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

const now = Date.now()
const cwd = root.replace(/\\/g, '/')
const events = [
  { type: 'user', data: { text: '帮我把导出脚本重构一下，顺便跑一下测试' } },
  {
    type: 'text',
    data: {
      text:
        '## 导出脚本重构方案\n\n问题有三个：\n\n1. 同步读取目录，大目录会卡住主线程\n2. 错误直接 throw，没有上下文\n3. 导出格式硬编码\n\n```ts\nexport async function exportSessions(dir: string) {\n  const files = await fs.readdir(dir)\n  return Promise.all(files.map((f) => readSession(f)))\n}\n```\n',
    },
  },
  {
    type: 'tool',
    data: {
      id: 'call_1',
      title: '读取 scripts/export.mjs',
      kind: 'read',
      status: 'completed',
      content: [{ type: 'diff', path: 'scripts/export.mjs', oldText: 'const files = fs.readdirSync(dir)', newText: 'const files = await fs.readdir(dir)' }],
    },
  },
  {
    type: 'plan',
    data: {
      entries: [
        { content: '阅读导出脚本与测试', status: 'completed' },
        { content: '改成异步实现', status: 'in_progress' },
        { content: '补空目录用例', status: 'pending' },
      ],
    },
  },
  { type: 'workflow', data: { kind: 'workflow_run_started', runId: 'wf_1', name: '发布前检查', status: 'running', agentCount: 4, cachedCount: 1, phaseCount: 2 } },
  { type: 'workflow', data: { kind: 'workflow_phase_started', runId: 'wf_1', phase: '设计' } },
  { type: 'workflow', data: { kind: 'workflow_phase_finished', runId: 'wf_1', phase: '设计' } },
  { type: 'workflow', data: { kind: 'workflow_phase_started', runId: 'wf_1', phase: '实现' } },
  { type: 'workflow', data: { kind: 'workflow_agent_started', runId: 'wf_1', agentKey: 'a1', agentLabel: '写导出脚本', agentPhase: '实现' } },
  {
    type: 'workflow',
    data: { kind: 'workflow_agent_finished', runId: 'wf_1', agentKey: 'a1', agentLabel: '写导出脚本', agentPhase: '实现', agentError: 'TypeError: fs.readdir is not a function（scripts/export.mjs:42）' },
  },
  { type: 'usage', data: { used: 42000, size: 200000, credits: 0.32 } },
]

fs.writeFileSync(
  path.join(dataDir, 'sessions.json'),
  JSON.stringify({
    sessions: [
      {
        id: 's_visual',
        title: '重构导出脚本',
        cwd,
        model: 'deepseek-v4.1-flash',
        mode: 'fullAccess',
        createdAt: now - 600000,
        updatedAt: now - 30000,
        events,
        usage: { used: 42000, size: 200000, credits: 0.9, charged: 0.9 },
      },
    ],
    lastSessionId: 's_visual',
  }),
)
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ lastWorkspace: cwd, lastWorkspaceId: '' }))

function run(name, evalScript, wait) {
  const shot = path.join(outDir, name + '.png')
  const result = spawnSync(
    exe,
    [
      '--demo',
      '--cwd',
      root,
      '--eval',
      evalScript,
      '--wait',
      String(wait),
      '--shot',
      shot,
    ],
    {
      // 注意：不要加 windowsHide，会让 WebView2 初始化失败
      env: { ...process.env, WORKBUDDY_LITE_DATA: dataDir },
      stdio: 'ignore',
      timeout: 60000,
    },
  )
  if (result.status !== 0 || !fs.existsSync(shot)) {
    console.error('✗', name, 'failed')
    process.exitCode = 1
  } else {
    console.log('✓', path.relative(root, shot))
  }
}

const openSession =
  "document.querySelectorAll('aside button').length && [].slice.call(document.querySelectorAll('aside button')).filter(function (b) { return (b.textContent || '').indexOf('重构导出脚本') >= 0 })[0].click()"

run('chat', `setTimeout(function(){${openSession}},700)`, 2600)
run('workbench', `setTimeout(function(){${openSession};setTimeout(function(){__wbl.openWorkbench('tasks')},700)},600)`, 3000)
run('empty', 'setTimeout(function(){document.getElementById("new-session").click()},700)', 2400)
