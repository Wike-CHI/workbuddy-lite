import { RotateCw, Users, Volume2, VolumeX } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { agentsOfChannel, useTeamStore, type TeamAgent, type TeamChannel } from '@/store/team'

import { BotAvatar } from './BotAvatar'

function statusLabel(presence?: string) {
  if (!presence) return '空闲'
  if (presence === 'active' || presence === 'online') return '在线'
  if (presence === 'offline' || presence === 'gone') return '离线'
  return '空闲'
}

export function ChannelMembersPopover({ channel }: { channel: TeamChannel }) {
  const agents = useTeamStore((s) => s.agents)
  const presence = useTeamStore((s) => s.presence)
  const channelMaxMembers = useTeamStore((s) => s.channelMaxMembers)
  const orchestrationEnabled = useTeamStore((s) => s.orchestrationEnabled)
  const toggleMute = useTeamStore((s) => s.toggleMute)
  const restartAgent = useTeamStore((s) => s.restartAgent)

  const members = agentsOfChannel(channel, agents)
  const lead = members.find((agent) => agent.id === channel.leadAgentId)
  // 组长已置顶展示，列表里不重复
  const ordered = lead ? members.filter((agent) => agent.id !== lead.id) : members
  const overflow = channel.memberAgentIds.length > channelMaxMembers

  const renderRow = (agent: TeamAgent) => {
    const muted = channel.mutedAgentIds.includes(agent.id)
    const offline = ['offline', 'gone'].includes(presence[agent.id] || '')
    const isLead = agent.id === channel.leadAgentId
    return (
      <div
        key={agent.id}
        className="group flex items-center gap-2 rounded-lg px-1 py-1.5 transition-colors hover:bg-surface-2/60"
      >
        <BotAvatar agentId={agent.id} name={agent.name} presence={presence[agent.id]} size={22} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] text-ink">{agent.name}</span>
            {isLead && (
              <span className="shrink-0 rounded-[3px] border border-primary/35 px-1 text-[9.5px] leading-4 text-primary">
                组长
              </span>
            )}
            {muted && <span className="shrink-0 text-[9.5px] text-ink-4">已静音</span>}
          </div>
          <div className="truncate text-[10.5px] text-ink-4">
            {[agent.title, agent.model, statusLabel(presence[agent.id])].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button
          type="button"
          title={muted ? '取消静音' : '静音'}
          onClick={() => void toggleMute(agent.id, !muted)}
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded transition-colors hover:bg-surface-3 hover:text-ink-2',
            muted ? 'text-ink-3' : 'text-ink-4',
          )}
        >
          {muted ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
        </button>
        {offline && (
          <button
            type="button"
            title="重启成员"
            onClick={() => void restartAgent(agent.id)}
            className="grid size-6 shrink-0 place-items-center rounded text-ink-4 transition-colors hover:bg-surface-3 hover:text-ink-2"
          >
            <RotateCw className="size-3.5" />
          </button>
        )}
      </div>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          id="channel-members"
          title="频道资料与成员"
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11.5px] text-ink-2 transition-colors hover:bg-surface-2"
        >
          <Users className="size-3.5 text-ink-3" />
          资料
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="flex items-baseline gap-2 px-1 pb-1.5 pt-0.5">
          <span className="text-[12px] font-medium text-ink">成员</span>
          <span className="font-mono text-[10.5px] text-ink-4">
            {channel.memberAgentIds.length}/{channelMaxMembers}
          </span>
          {overflow && <span className="text-[10px] text-warn">超过上限</span>}
        </div>

        {lead ? (
          <div className="mb-1 rounded-lg bg-surface-2/70 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <BotAvatar agentId={lead.id} name={lead.name} presence={presence[lead.id]} size={22} />
              <span className="text-[12px] text-ink">{lead.name}</span>
              <span className="rounded-[3px] border border-primary/35 px-1 text-[9.5px] leading-4 text-primary">
                组长
              </span>
            </div>
            <div className="mt-1 text-[10.5px] leading-4 text-ink-4">负责派单、催办和最终收口</div>
          </div>
        ) : (
          <div className="mb-1 rounded-lg bg-surface-2/70 px-2 py-1.5 text-[10.5px] leading-4 text-ink-4">
            没有组长，由用户负责编排：只有被 @ 的成员会被唤醒。
          </div>
        )}

        <div className="max-h-64 overflow-y-auto">{ordered.map(renderRow)}</div>

        <div className="mt-1 border-t border-border/70 px-1 pt-1.5 text-[10px] leading-4 text-ink-4">
          v1 只支持静音与重启。增删成员、设组长请在 CodeBuddy 的频道里操作。
          {orchestrationEnabled && ' 当前 CLI 已开启自动接力，壳只展示该状态。'}
        </div>
      </PopoverContent>
    </Popover>
  )
}
