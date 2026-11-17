import type { TeamAgent } from '@/store/team'

export function ChannelLiveRow({ agents }: { agents: TeamAgent[] }) {
  if (!agents.length) return null
  const names = agents.map((agent) => agent.name).join('、')
  return (
    <div className="flex pl-[30px]" role="status" aria-live="polite">
      <div className="inline-flex min-w-0 items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 text-[11.5px] text-ink-2">
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
        <span className="truncate">
          {names} 正在处理…
        </span>
      </div>
    </div>
  )
}
