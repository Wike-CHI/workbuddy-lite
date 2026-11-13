import type { DataMessagePartProps } from '@assistant-ui/react'
import { ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chat'
import type { PermissionData } from '@/lib/types'

export function PermissionPart({ data }: DataMessagePartProps<PermissionData>) {
  const resolve = useChatStore((s) => s.resolvePermission)
  if (!data?.requestId) return null
  const options: PermissionData['options'] = data.options || []
  const resolved = data.resolvedOptionId
    ? options.find((o) => o.optionId === data.resolvedOptionId)?.name || data.resolvedOptionId
    : ''

  return (
    <div className="rounded-xl border border-[#f0d9a8] bg-warning-soft px-3.5 py-3">
      <div className="flex items-start gap-2 text-[13px] text-[#7a5410]">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <span>{data.title}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {resolved ? (
          <span className="text-[12px] text-muted-foreground">已选择：{resolved}</span>
        ) : (
          options.map((option, index) => (
            <Button
              key={option.optionId}
              data-permission-option={option.optionId}
              size="sm"
              variant={index === 0 ? 'default' : 'outline'}
              className={index === 0 ? 'bg-[#7a5410] hover:bg-[#66450d]' : 'border-[#e8cf9a] text-[#7a5410]'}
              onClick={() => void resolve(data.requestId, option.optionId)}
            >
              {option.name || option.optionId}
            </Button>
          ))
        )}
      </div>
    </div>
  )
}
