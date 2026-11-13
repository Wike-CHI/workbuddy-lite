import type { DataMessagePartProps } from '@assistant-ui/react'
import { Sparkles } from 'lucide-react'

import { fmtCredits } from '@/lib/format'
import { useUiStore } from '@/store/ui'
import type { UsagePartData } from '@/lib/types'

export function UsagePart({ data }: DataMessagePartProps<UsagePartData>) {
  const setUsageOpen = useUiStore((s) => s.setUsageOpen)
  const nominal = Number(data?.nominal || 0)
  const actual = Number(data?.actual || 0)
  if (!nominal && !actual) return null
  const free = nominal > 0 && actual === 0
  return (
    <button
      type="button"
      onClick={() => setUsageOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-md border border-[#f0e2c0] bg-warning-soft px-2 py-1 text-[10.5px] text-[#8a6a1f] transition-colors hover:brightness-[.98]"
      title={`实扣 ${fmtCredits(actual)} 积分${free ? '（免费额度抵扣）' : ''}，点击查看额度`}
    >
      <Sparkles className="size-3" />
      本轮 {fmtCredits(nominal || actual)} 积分
      {free && <span className="text-success">· 免费额度</span>}
    </button>
  )
}
