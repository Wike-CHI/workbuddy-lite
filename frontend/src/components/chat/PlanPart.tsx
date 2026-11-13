import type { DataMessagePartProps } from '@assistant-ui/react'
import { Circle, CircleCheck, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { PlanEntry } from '@/lib/types'

export function PlanPart({ data }: DataMessagePartProps<{ entries: PlanEntry[] }>) {
  const entries: PlanEntry[] = data?.entries || []
  if (!entries.length) return null
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-3.5 py-2.5">
      <div className="mb-1.5 text-[10.5px] font-medium tracking-wide text-muted-foreground">执行计划</div>
      <ul className="space-y-1">
        {entries.map((entry, index) => {
          const status = String(entry.status || 'pending').replace(/-/g, '_')
          const Icon = status === 'completed' ? CircleCheck : status === 'in_progress' ? Loader2 : Circle
          return (
            <li
              key={index}
              className={cn(
                'flex items-start gap-2 text-[12.5px]',
                status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground',
              )}
            >
              <Icon
                className={cn(
                  'mt-0.5 size-3 shrink-0',
                  status === 'completed' && 'text-success',
                  status === 'in_progress' && 'animate-spin text-primary',
                  status === 'pending' && 'text-muted-foreground/60',
                )}
              />
              <span>{entry.content}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
