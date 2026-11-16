import { Bot, ChevronDown, ChevronRight, Clock, Layers, Workflow } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import type { AcpEvent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'
import { useWorkbenchStore } from '@/store/workbench'

export interface WorkflowAgentView {
  key: string
  label: string
  phase: string
  status: string
  tokens: number
  error?: string
  output: string
}

export interface WorkflowRunView {
  id: string
  name: string
  status: string
  agentCount: number
  cachedCount: number
  phaseCount: number
  phases: { name: string; status: string }[]
  agents: WorkflowAgentView[]
  error?: string
}

export function workflowRuns(events: AcpEvent[]): WorkflowRunView[] {
  const runs = new Map<string, WorkflowRunView>()

  const ensure = (id: string) => {
    if (!runs.has(id)) {
      runs.set(id, {
        id,
        name: '工作流',
        status: 'running',
        agentCount: 0,
        cachedCount: 0,
        phaseCount: 0,
        phases: [],
        agents: [],
      })
    }
    return runs.get(id)!
  }

  for (const event of events) {
    if (event.type !== 'workflow') continue
    const data = event.data || {}
    const id = String(data.runId || '')
    if (!id) continue
    const run = ensure(id)
    const kind = String(data.kind || '')
    if (data.name) run.name = String(data.name)
    if (data.status) run.status = String(data.status)
    if (typeof data.agentCount === 'number') run.agentCount = data.agentCount
    if (typeof data.cachedCount === 'number') run.cachedCount = data.cachedCount
    if (typeof data.phaseCount === 'number') run.phaseCount = data.phaseCount
    if (data.error) run.error = String(data.error)

    if (kind === 'workflow_phase_started' || kind === 'workflow_phase_finished') {
      const name = String(data.phase || '')
      if (!name) continue
      const existing = run.phases.find((phase) => phase.name === name)
      const status = kind === 'workflow_phase_finished' ? 'finished' : 'running'
      if (existing) existing.status = status
      else run.phases.push({ name, status })
    }

    if (kind.startsWith('workflow_agent_')) {
      const key = String(data.agentKey || '')
      if (!key) continue
      const status =
        kind === 'workflow_agent_started'
          ? 'running'
          : kind === 'workflow_agent_cached'
            ? 'cached'
            : data.agentError
              ? 'failed'
              : 'completed'
      const agent: WorkflowAgentView = {
        key,
        label: String(data.agentLabel || key),
        phase: String(data.agentPhase || ''),
        status,
        tokens: Number(data.agentTokens || 0),
        error: data.agentError ? String(data.agentError) : undefined,
        output: '',
      }
      const index = run.agents.findIndex((item) => item.key === key)
      if (index >= 0) run.agents[index] = { ...run.agents[index], ...agent }
      else run.agents.push(agent)
    }
  }

  // 优先用 workflowAgentKey 归集；CLI 没带这个字段时，按「上一个 started 的代理」兜底
  let active: { runId: string; key: string } | null = null
  for (const event of events) {
    const data = event.data || {}
    if (event.type === 'workflow') {
      const kind = String(data.kind || '')
      const runId = String(data.runId || '')
      if (kind === 'workflow_agent_started' && data.agentKey) {
        active = { runId, key: String(data.agentKey) }
      } else if (kind === 'workflow_agent_finished' || kind === 'workflow_agent_cached') {
        if (active && active.key === String(data.agentKey || '')) active = null
      }
      continue
    }
    if (event.type !== 'text' && event.type !== 'tool') continue
    if (data.parentToolCallId) continue
    const key = data.workflowAgentKey ? String(data.workflowAgentKey) : active?.key
    if (!key) continue
    const run = runs.get(String(data.runId || active?.runId || ''))
    if (!run) continue
    const agent = run.agents.find((item) => item.key === key)
    if (!agent) continue
    if (event.type === 'text') {
      const text = String(data.text || '')
      if (text.trim()) agent.output = (agent.output + text).slice(0, 4000)
    } else {
      const title = String(data.title || '工具')
      agent.output = (agent.output + `\n→ ${title}`).slice(0, 4000)
    }
  }

  return [...runs.values()]
}

function WorkflowCard({ run }: { run: WorkflowRunView }) {
  const send = useChatStore((s) => s.send)
  const [openPhase, setOpenPhase] = React.useState<string | null>(null)

  const done = run.agents.filter((agent) => agent.status === 'completed' || agent.status === 'cached').length
  const total = run.agentCount || run.agents.length
  const running = run.agents.filter((agent) => agent.status === 'running').length
  const pct = total ? Math.round((done / total) * 100) : 0

  const phaseNames = Array.from(
    new Set([...run.phases.map((phase) => phase.name), ...run.agents.map((agent) => agent.phase).filter(Boolean)]),
  )
  const phaseStatus = (name: string) => run.phases.find((phase) => phase.name === name)?.status || 'running'
  const phaseAgents = openPhase ? run.agents.filter((agent) => agent.phase === openPhase) : []

  const runRetry = async (agent: WorkflowAgentView) => {
    const detail = agent.error ? `：${agent.error}` : ''
    const prompt =
      `工作流「${run.name}」(runId: ${run.id}) 的阶段「${agent.phase || '未标注'}」中代理「${agent.label}」失败了${detail}。` +
      '请用 workflow control 只重跑这个失败代理，已经完成的阶段和代理不要重跑。'
    try {
      await send(prompt)
      toast.success('已发给 agent，进度会回到这个面板')
    } catch (error) {
      toast.error('发送失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  // 二次确认走 toast，不弹系统对话框
  const askRetry = (agent: WorkflowAgentView) => {
    toast(`重跑「${agent.label}」？`, {
      description: '只让 agent 用 workflow control 重跑这个失败代理，会消耗积分',
      duration: 10000,
      action: {
        label: '重跑',
        onClick: () => void runRetry(agent),
      },
      cancel: {
        label: '取消',
        onClick: () => undefined,
      },
    })
  }

  return (
    <div className="mb-1.5 rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Workflow className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium" title={run.name}>
          {run.name}
        </span>
        {running > 0 && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />}
        <span className="shrink-0 font-mono text-[10px] text-primary">
          {done}/{total || '?'}
        </span>
      </div>
      <div className="px-2 pb-1">
        <div className="h-1 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {phaseNames.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pb-1.5">
          {phaseNames.map((name) => {
            const active = openPhase === name
            const finished = phaseStatus(name) === 'finished'
            const count = run.agents.filter((agent) => agent.phase === name).length
            return (
              <button
                key={name}
                type="button"
                onClick={() => setOpenPhase(active ? null : name)}
                className={cn(
                  'flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10px] transition-colors',
                  finished ? 'text-ink-2' : 'text-ink-2',
                  active ? 'bg-surface-2' : 'hover:bg-surface-2',
                )}
                title={count ? `看 ${name} 阶段的 ${count} 个代理` : name}
              >
                <span className={cn('size-1 rounded-full', finished ? 'bg-ok' : 'bg-warning')} />
                {name}
                {count > 0 && <span className="text-ink-4">{count}</span>}
              </button>
            )
          })}
        </div>
      )}

      {openPhase ? (
        <div className="space-y-1 border-t border-border px-2 py-1.5">
          <div className="text-[9.5px] text-muted-foreground">阶段「{openPhase}」的代理</div>
          {!phaseAgents.length && <div className="text-[10px] text-muted-foreground">这个阶段还没有代理记录</div>}
          {phaseAgents.map((agent) => (
            <div key={agent.key} className="rounded border border-border bg-surface-2/60 px-1.5 py-1">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    agent.status === 'running'
                      ? 'animate-pulse bg-primary'
                      : agent.status === 'failed'
                        ? 'bg-destructive'
                        : agent.status === 'cached'
                          ? 'bg-ink-4'
                          : 'bg-ok',
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{agent.label}</span>
                {agent.tokens > 0 && (
                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{agent.tokens} tok</span>
                )}
                {agent.status === 'failed' && (
                  <button
                    type="button"
                    className="shrink-0 rounded bg-destructive/10 px-1 py-0.5 text-[9px] text-destructive hover:bg-destructive/20"
                    onClick={() => askRetry(agent)}
                  >
                    重跑
                  </button>
                )}
              </div>
              {agent.error && (
                <div className="mt-0.5 whitespace-pre-wrap break-words text-[9.5px] text-destructive">{agent.error}</div>
              )}
              {agent.output ? (
                <div className="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[9.5px] leading-4 text-muted-foreground">
                  {agent.output}
                </div>
              ) : (
                !agent.error && (
                  <div className="mt-0.5 text-[9.5px] text-muted-foreground/70">
                    {agent.status === 'running' ? '还在跑…' : '没有回传文本（CLI 只上报状态和 token）'}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      ) : (
        run.agents.length > 0 && (
          <div className="space-y-0.5 border-t border-border px-2 py-1">
            {run.agents.slice(0, 6).map((agent) => (
              <div key={agent.key} className="flex items-center gap-1.5 text-[10px]">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    agent.status === 'running'
                      ? 'animate-pulse bg-primary'
                      : agent.status === 'failed'
                        ? 'bg-destructive'
                        : agent.status === 'cached'
                          ? 'bg-ink-4'
                          : 'bg-ok',
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{agent.label}</span>
                {agent.phase && <span className="shrink-0 text-muted-foreground">{agent.phase}</span>}
                {agent.tokens > 0 && <span className="shrink-0 font-mono text-muted-foreground">{agent.tokens}</span>}
                {agent.status === 'failed' && (
                  <button
                    type="button"
                    className="shrink-0 rounded px-1 text-[9.5px] text-destructive hover:underline"
                    onClick={() => askRetry(agent)}
                  >
                    重跑
                  </button>
                )}
              </div>
            ))}
            {run.agents.length > 6 && (
              <div className="text-[9.5px] text-muted-foreground">还有 {run.agents.length - 6} 个代理…</div>
            )}
          </div>
        )
      )}

      {run.error && <div className="px-2 pb-1 text-[9.5px] text-destructive">{run.error}</div>}
    </div>
  )
}

export interface AgentRun {
  id: string
  title: string
  type: string
  background: boolean
  status: string
  children: AcpEvent[]
  tools: number
  texts: string[]
}

export function agentRuns(events: AcpEvent[]): AgentRun[] {
  const runs = new Map<string, AgentRun>()

  const ensure = (id: string): AgentRun => {
    if (!runs.has(id)) {
      runs.set(id, {
        id,
        title: '子智能体',
        type: '',
        background: false,
        status: 'in_progress',
        children: [],
        tools: 0,
        texts: [],
      })
    }
    return runs.get(id)!
  }

  for (const event of events) {
    if (event.type !== 'tool') continue
    const data = event.data || {}
    if (!data.isSubagent && !data.subagentType) continue
    const run = ensure(String(data.id))
    run.title = String(data.title || data.subagentType || '子智能体')
    run.type = String(data.subagentType || '')
    run.background = !!data.isBackground
    run.status = String(data.status || 'in_progress')
  }

  for (const event of events) {
    const parentId = event.data?.parentToolCallId
    if (!parentId) continue
    const run = ensure(String(parentId))
    if (run.title === '子智能体') {
      const title = event.data?.title
      if (typeof title === 'string' && title) run.title = title
    }
    run.children.push(event)
    if (event.type === 'tool') run.tools += 1
    if (event.type === 'tool_update') {
      const status = String(event.data?.status || '')
      if (status) run.status = status
    }
    if (event.type === 'text' && typeof event.data?.text === 'string') {
      run.texts.push(event.data.text)
    }
    if (event.data?.isBackground) run.background = true
  }

  return [...runs.values()]
}

function isRunning(status: string) {
  return status === 'in_progress' || status === 'running' || status === 'pending'
}

function ChildList({ run }: { run: AgentRun }) {
  const steps = run.children.filter((event) => event.type === 'tool' || event.type === 'text')
  if (!steps.length) {
    return <div className="px-2 py-1.5 text-[10.5px] text-muted-foreground">还没有可展示的步骤</div>
  }
  return (
    <div className="space-y-0.5 px-1 py-1">
      {steps.map((event, index) => {
        if (event.type === 'text') {
          const text = String(event.data?.text || '')
          if (!text.trim()) return null
          return (
            <div key={index} className="rounded bg-muted/40 px-2 py-1 text-[10.5px] leading-4 text-muted-foreground">
              {text.length > 220 ? text.slice(0, 220) + '…' : text}
            </div>
          )
        }
        return (
          <div key={index} className="flex items-center gap-1.5 px-1 text-[10.5px]">
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                event.data?.status === 'completed'
                  ? 'bg-ok'
                  : event.data?.status === 'failed'
                    ? 'bg-destructive'
                    : 'bg-[#0969da]',
              )}
            />
            <span className="min-w-0 flex-1 truncate">{String(event.data?.title || event.data?.kind || '工具')}</span>
          </div>
        )
      })}
    </div>
  )
}

export function TasksPanel() {
  const events = useChatStore((s) => s.events)
  const runs = React.useMemo(() => agentRuns(events), [events])
  const workflows = React.useMemo(() => workflowRuns(events), [events])
  const [openIds, setOpenIds] = React.useState<string[]>([])
  const [onlyRunning, setOnlyRunning] = React.useState(false)
  const taskFocus = useWorkbenchStore((s) => s.taskFocus)

  // 侧栏点某个子智能体时，展开并滚到它
  React.useEffect(() => {
    if (!taskFocus) return
    setOpenIds((prev) => (prev.includes(taskFocus) ? prev : [...prev, taskFocus]))
    requestAnimationFrame(() => {
      document.getElementById('task-' + taskFocus)?.scrollIntoView({ block: 'nearest' })
    })
  }, [taskFocus])

  if (!runs.length && !workflows.length) {
    return (
      <div className="px-4 py-8 text-center text-[11px] leading-5 text-muted-foreground">
        还没有子智能体、工作流或后台任务。
        <br />
        agent 调用 Task / 子代理 / workflow 时，这里会列出运行状态、阶段和每一步。
      </div>
    )
  }

  const sorted = [...runs].sort((a, b) => Number(isRunning(b.status)) - Number(isRunning(a.status)))
  const visible = onlyRunning ? sorted.filter((run) => isRunning(run.status)) : sorted

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {workflows.length > 0 && (
        <div className="mb-2">
          <div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            工作流
          </div>
          {workflows.slice(0, 3).map((run) => (
            <WorkflowCard key={run.id} run={run} />
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">子智能体</span>
          <div className="flex overflow-hidden rounded border border-border text-[10px]">
            <button
              type="button"
              className={cn('px-1.5 py-0.5', !onlyRunning ? 'bg-muted text-foreground' : 'text-muted-foreground')}
              onClick={() => setOnlyRunning(false)}
            >
              全部
            </button>
            <button
              type="button"
              className={cn('px-1.5 py-0.5', onlyRunning ? 'bg-muted text-foreground' : 'text-muted-foreground')}
              onClick={() => setOnlyRunning(true)}
            >
              进行中
            </button>
          </div>
        </div>
      )}

      {onlyRunning && !visible.length && (
        <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">没有正在跑的子智能体</div>
      )}

      {visible.map((run) => {
        const open = openIds.includes(run.id)
        return (
          <div key={run.id} id={'task-' + run.id} className="mb-1.5 rounded-lg border border-border/70 bg-card">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
              onClick={() => setOpenIds((prev) => (open ? prev.filter((id) => id !== run.id) : [...prev, run.id]))}
            >
              {open ? (
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              )}
              <Bot className="size-3.5 shrink-0 text-[#8250df]" />
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{run.title}</span>
              {run.background && <Badge variant="secondary">后台</Badge>}
              {run.type && (
                <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                  {run.type}
                </span>
              )}
              {isRunning(run.status) ? (
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#0969da]" />
              ) : (
                <Clock className="size-3 shrink-0 text-muted-foreground" />
              )}
            </button>
            <div className="flex items-center gap-2 border-t border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Layers className="size-3" />
                {run.tools} 步工具
              </span>
              <span>{run.status}</span>
              <span className="ml-auto">{run.children.length} 条事件</span>
            </div>
            {open && <ChildList run={run} />}
          </div>
        )
      })}
    </div>
  )
}
