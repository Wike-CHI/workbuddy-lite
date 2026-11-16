import { Bot, ChevronDown, ChevronRight, Clock, Layers, Workflow } from 'lucide-react'
import * as React from 'react'

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
      }
      const index = run.agents.findIndex((item) => item.key === key)
      if (index >= 0) run.agents[index] = { ...run.agents[index], ...agent }
      else run.agents.push(agent)
    }
  }

  return [...runs.values()]
}

function WorkflowCard({ run }: { run: WorkflowRunView }) {
  const done = run.agents.filter((agent) => agent.status === 'completed' || agent.status === 'cached').length
  const total = run.agentCount || run.agents.length
  const running = run.agents.filter((agent) => agent.status === 'running').length
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div className="mb-1.5 rounded-lg border border-[#cfe0ff] bg-[#f5f9ff]">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Workflow className="size-3.5 shrink-0 text-[#1a73e8]" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium" title={run.name}>
          {run.name}
        </span>
        {running > 0 && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#1a73e8]" />}
        <span className="shrink-0 font-mono text-[10px] text-[#1a73e8]">
          {done}/{total || '?'}
        </span>
      </div>
      <div className="px-2 pb-1">
        <div className="h-1 overflow-hidden rounded-full bg-[#dce8fb]">
          <div className="h-full rounded-full bg-[#1a73e8] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {run.phases.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pb-1.5">
          {run.phases.map((phase) => (
            <span
              key={phase.name}
              className={cn(
                'rounded px-1 py-0.5 text-[9.5px]',
                phase.status === 'finished' ? 'bg-[#e6f4ea] text-[#1a7f37]' : 'bg-[#fef7e0] text-[#9a6700]',
              )}
            >
              {phase.name}
            </span>
          ))}
        </div>
      )}
      {run.agents.length > 0 && (
        <div className="space-y-0.5 border-t border-[#dce8fb] px-2 py-1">
          {run.agents.slice(0, 6).map((agent) => (
            <div key={agent.key} className="flex items-center gap-1.5 text-[10px]">
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  agent.status === 'running'
                    ? 'animate-pulse bg-[#1a73e8]'
                    : agent.status === 'failed'
                      ? 'bg-destructive'
                      : agent.status === 'cached'
                        ? 'bg-[#9aa0a6]'
                        : 'bg-[#1a7f37]',
                )}
              />
              <span className="min-w-0 flex-1 truncate">{agent.label}</span>
              {agent.phase && <span className="shrink-0 text-muted-foreground">{agent.phase}</span>}
              {agent.tokens > 0 && <span className="shrink-0 font-mono text-muted-foreground">{agent.tokens}</span>}
            </div>
          ))}
          {run.agents.length > 6 && (
            <div className="text-[9.5px] text-muted-foreground">还有 {run.agents.length - 6} 个代理…</div>
          )}
        </div>
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
                  ? 'bg-[#1a7f37]'
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
