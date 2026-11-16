import { Check, Circle, ListChecks, Loader2 } from 'lucide-react'
import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import type { AcpEvent, PlanEntry } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'

export function planInfo(events: AcpEvent[]) {
  let entries: PlanEntry[] = []
  let content = ''
  let path = ''
  for (const event of events) {
    if (event.type === 'plan' && Array.isArray(event.data?.entries)) entries = event.data.entries as PlanEntry[]
    if (typeof event.data?.planContent === 'string' && event.data.planContent) content = event.data.planContent
    if (typeof event.data?.planFilePath === 'string' && event.data.planFilePath) path = event.data.planFilePath
  }
  return { entries, content, path }
}

export function todoStats(entries: PlanEntry[]) {
  const done = entries.filter((entry) => entry.status === 'completed').length
  const active = entries.filter((entry) => entry.status === 'in_progress').length
  return { done, active, open: entries.length - done, total: entries.length }
}

function StatusIcon({ status }: { status?: string }) {
  if (status === 'completed') return <Check className="size-3.5 shrink-0 text-[#1a7f37]" />
  if (status === 'in_progress') return <Loader2 className="size-3.5 shrink-0 animate-spin text-[#0969da]" />
  return <Circle className="size-3 shrink-0 text-muted-foreground/60" />
}

function EntryList({ entries }: { entries: PlanEntry[] }) {
  return (
    <div className="space-y-1">
      {entries.map((entry, index) => (
        <div
          key={index}
          className={cn(
            'flex items-start gap-2 rounded-md px-2 py-1.5 text-[11.5px] leading-5',
            entry.status === 'in_progress' && 'bg-[#ddf4ff]/60',
          )}
        >
          <StatusIcon status={entry.status} />
          <span className={cn('min-w-0 flex-1', entry.status === 'completed' && 'text-muted-foreground line-through')}>
            {entry.content}
          </span>
        </div>
      ))}
    </div>
  )
}

export function PlanPanel() {
  const events = useChatStore((s) => s.events)
  const { entries, content, path } = React.useMemo(() => planInfo(events), [events])

  if (!entries.length && !content) {
    return (
      <div className="px-4 py-8 text-center text-[11px] leading-5 text-muted-foreground">
        还没有计划。
        <br />
        让 agent 先给一个执行计划（或开启「只读规划」模式），这里会同步显示。
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {content && (
        <div className="mb-2 rounded-lg border border-border/70 bg-card">
          <div className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5 text-[10.5px] text-muted-foreground">
            <ListChecks className="size-3" />
            <span className="min-w-0 flex-1 truncate" title={path}>
              {path ? path.split(/[\\/]/).pop() : '计划文档'}
            </span>
          </div>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap px-2.5 py-2 text-[11px] leading-5">
            {content}
          </pre>
        </div>
      )}
      {!!entries.length && (
        <div className="rounded-lg border border-border/70 bg-card px-1.5 py-1.5">
          <div className="px-1 pb-1 text-[10.5px] text-muted-foreground">步骤</div>
          <EntryList entries={entries} />
        </div>
      )}
    </div>
  )
}

export function TodosPanel() {
  const events = useChatStore((s) => s.events)
  const entries = React.useMemo(() => planInfo(events).entries, [events])
  const stats = todoStats(entries)

  if (!entries.length) {
    return (
      <div className="px-4 py-8 text-center text-[11px] leading-5 text-muted-foreground">
        还没有待办。
        <br />
        agent 给出计划步骤后，这里会按 未开始 / 进行中 / 已完成 列出来。
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-2">
        <span className="text-[11px] text-muted-foreground">
          已完成 {stats.done}/{stats.total}
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[#1a7f37] transition-all"
            style={{ width: `${stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%` }}
          />
        </div>
        {stats.active > 0 && <Badge variant="secondary">{stats.active} 进行中</Badge>}
      </div>
      <EntryList entries={entries} />
    </div>
  )
}
