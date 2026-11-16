import type { DataMessagePartProps } from '@assistant-ui/react'
import { Check, Circle, Loader2 } from 'lucide-react'

import type { PlanEntry } from '@/lib/types'
import { cn } from '@/lib/utils'

export function PlanPart({ data }: DataMessagePartProps<{ entries: PlanEntry[] }>) {
  const entries: PlanEntry[] = data?.entries || []
  if (!entries.length) return null
  const done = entries.filter((entry) => entry.status === 'completed').length

  return (
    <div className="my-1 border-l-2 border-border pl-3">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-3">
        <span className="font-medium">计划</span>
        <span className="tabular-nums">
          {done}/{entries.length}
        </span>
      </div>
      <ul className="space-y-1">
        {entries.map((entry, index) => {
          const status = String(entry.status || 'pending').replace(/-/g, '_')
          return (
            <li
              key={index}
              className={cn(
                'flex items-start gap-2 text-[12.5px] leading-5',
                status === 'completed' ? 'text-ink-3' : 'text-ink',
              )}
            >
              {status === 'completed' ? (
                <Check className="mt-[3px] size-3 shrink-0 text-ok" />
              ) : status === 'in_progress' ? (
                <Loader2 className="mt-[3px] size-3 shrink-0 animate-spin text-primary" />
              ) : (
                <Circle className="mt-[3px] size-2.5 shrink-0 text-ink-4" />
              )}
              <span className={cn(status === 'completed' && 'line-through decoration-border')}>{entry.content}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
