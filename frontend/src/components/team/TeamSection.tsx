import { Plus, Users } from 'lucide-react'

import { cn } from '@/lib/utils'
import { agentsOfChannel, useTeamStore } from '@/store/team'

import { BotAvatar } from './BotAvatar'

export function TeamSection() {
  const ready = useTeamStore((s) => s.ready)
  const enabled = useTeamStore((s) => s.enabled)
  const canCreate = useTeamStore((s) => s.canCreate)
  const error = useTeamStore((s) => s.error)
  const channels = useTeamStore((s) => s.channels)
  const agents = useTeamStore((s) => s.agents)
  const presence = useTeamStore((s) => s.presence)
  const activeChannelId = useTeamStore((s) => s.activeChannelId)
  const workingAgentIds = useTeamStore((s) => s.workingAgentIds)
  const openChannel = useTeamStore((s) => s.openChannel)
  const closeChannel = useTeamStore((s) => s.closeChannel)
  const loadState = useTeamStore((s) => s.loadState)
  const openCreate = useTeamStore((s) => s.openCreate)

  if (!ready) return null

  return (
    <section className="mt-1.5 border-t border-border/70 pt-1.5">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <Users className="size-3 shrink-0 text-ink-4" />
        <span className="text-[10.5px] font-medium text-ink-4">团队</span>
        <span className="ml-auto font-mono text-[10px] text-ink-4">
          {enabled ? channels.length : '—'}
        </span>
      </div>

      {!enabled && (
        <button
          type="button"
          onClick={() => void loadState()}
          title={error || '点击重试'}
          className="line-clamp-2 w-full px-2 pb-1 text-left text-[10.5px] leading-4 text-ink-4 transition-colors hover:text-ink-2"
        >
          {error ? `团队不可用：${error}` : '团队不可用'} · <span className="underline">重试</span>
        </button>
      )}

      {enabled && (
        <div className="max-h-[30vh] space-y-px overflow-y-auto pb-1">
          {!channels.length && (
            <div className="px-2 py-2 text-[10.5px] leading-4 text-ink-4">
              {canCreate ? '还没有频道，点下面「新建频道」组一个' : '还没有频道，在 CodeBuddy 里创建一个'}
            </div>
          )}
          {channels.map((channel) => {
            const active = channel.id === activeChannelId
            const lead = agents.find((agent) => agent.id === channel.leadAgentId)
            const members = agentsOfChannel(channel, agents)
            const avatarAgent = members.find((agent) => agent.id === channel.leadAgentId) || members[0]
            const working = active && workingAgentIds.length > 0
            const preview = working
              ? `${agents.find((agent) => agent.id === workingAgentIds[0])?.name || '成员'} 正在处理…`
              : channel.lastPreview || '还没开工'
            return (
              <button
                key={channel.id}
                id={`team-channel-${channel.id}`}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  if (active) closeChannel()
                  else void openChannel(channel.id)
                }}
                title={`${channel.name}\n${preview}`}
                className={cn(
                  'group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  active ? 'bg-surface' : 'hover:bg-surface-3/60',
                )}
              >
                <span className="pt-0.5">
                  <BotAvatar
                    agentId={avatarAgent?.id || channel.id}
                    name={avatarAgent?.name || channel.name}
                    presence={presence[avatarAgent?.id || '']}
                    size={22}
                    surface="sidebar"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <span
                      className={cn(
                        'truncate text-[12px]',
                        active ? 'font-medium text-ink' : 'text-ink-2',
                      )}
                    >
                      {channel.name}
                    </span>
                    {lead ? (
                      <span className="shrink-0 rounded-[3px] border border-primary/35 px-1 text-[9.5px] leading-4 text-primary">
                        组长
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-[3px] bg-surface-3 px-1 text-[9.5px] leading-4 text-ink-4">
                        用户编排
                      </span>
                    )}
                    {channel.unreadByUser > 0 && (
                      <span
                        className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-ink-3"
                        title={`${channel.unreadByUser} 条未读`}
                      >
                        <span className="size-1.5 rounded-full bg-primary" />
                        {channel.unreadByUser}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-ink-4">{preview}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {enabled && canCreate && (
        <button
          id="team-new-channel"
          type="button"
          onClick={openCreate}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11.5px] text-ink-3 transition-colors hover:bg-surface-3/60 hover:text-ink-2"
        >
          <Plus className="size-3.5 shrink-0" />
          新建频道
        </button>
      )}
    </section>
  )
}
