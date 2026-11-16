import { Bot, ChevronDown, ChevronRight, Clock, Layers } from 'lucide-react'
import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import type { AcpEvent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'
import { useWorkbenchStore } from '@/store/workbench'

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
  const [openIds, setOpenIds] = React.useState<string[]>([])
  const taskFocus = useWorkbenchStore((s) => s.taskFocus)

  // 侧栏点某个子智能体时，展开并滚到它
  React.useEffect(() => {
    if (!taskFocus) return
    setOpenIds((prev) => (prev.includes(taskFocus) ? prev : [...prev, taskFocus]))
    requestAnimationFrame(() => {
      document.getElementById('task-' + taskFocus)?.scrollIntoView({ block: 'nearest' })
    })
  }, [taskFocus])

  if (!runs.length) {
    return (
      <div className="px-4 py-8 text-center text-[11px] leading-5 text-muted-foreground">
        还没有子智能体或后台任务。
        <br />
        agent 调用 Task / 子代理时，这里会列出运行状态、类型和每一步。
      </div>
    )
  }

  const sorted = [...runs].sort((a, b) => Number(isRunning(b.status)) - Number(isRunning(a.status)))

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {sorted.map((run) => {
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
