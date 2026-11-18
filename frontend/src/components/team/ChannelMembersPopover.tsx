import {
  ArrowLeft,
  Check,
  Crown,
  Info,
  Loader2,
  Plus,
  RotateCw,
  UserMinus,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react'

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

// 成员面板：列表 + 组长状态 + 添加成员 + 新建智能体。
// 所有写操作都由后端 canManage 把关；旧后端的 state 没有这个字段，这里自动退回只读。
export function ChannelMembersPopover({ channel }: { channel: TeamChannel }) {
  const agents = useTeamStore((s) => s.agents)
  const presence = useTeamStore((s) => s.presence)
  const channelMaxMembers = useTeamStore((s) => s.channelMaxMembers)
  const orchestrationEnabled = useTeamStore((s) => s.orchestrationEnabled)
  const canManage = useTeamStore((s) => s.canManage)
  const membersOpen = useTeamStore((s) => s.membersOpen)
  const addOpen = useTeamStore((s) => s.addMembersOpen)
  const candidateIds = useTeamStore((s) => s.candidateIds)
  const membersSaving = useTeamStore((s) => s.membersSaving)
  const leadSaving = useTeamStore((s) => s.leadSaving)
  const setMembersOpen = useTeamStore((s) => s.setMembersOpen)
  const openAddMembers = useTeamStore((s) => s.openAddMembers)
  const closeAddMembers = useTeamStore((s) => s.closeAddMembers)
  const toggleCandidate = useTeamStore((s) => s.toggleCandidate)
  const addMembers = useTeamStore((s) => s.addMembers)
  const removeMember = useTeamStore((s) => s.removeMember)
  const setLead = useTeamStore((s) => s.setLead)
  const toggleMute = useTeamStore((s) => s.toggleMute)
  const restartAgent = useTeamStore((s) => s.restartAgent)
  const openAgentDetail = useTeamStore((s) => s.openAgentDetail)
  const openCreateAgent = useTeamStore((s) => s.openCreateAgent)

  const members = agentsOfChannel(channel, agents)
  const lead = members.find((agent) => agent.id === channel.leadAgentId)
  // 组长已置顶展示，列表里不重复
  const ordered = lead ? members.filter((agent) => agent.id !== lead.id) : members
  const overflow = channel.memberAgentIds.length > channelMaxMembers
  const room = Math.max(0, channelMaxMembers - channel.memberAgentIds.length)
  const candidates = agents.filter((agent) => !channel.memberAgentIds.includes(agent.id))
  const canRemove = canManage && channel.memberAgentIds.length > 2 && !membersSaving
  const removeHint =
    channel.memberAgentIds.length <= 2 ? '频道至少需要两个智能体' : '移出频道'

  const renderRow = (agent: TeamAgent) => {
    const muted = channel.mutedAgentIds.includes(agent.id)
    const offline = ['offline', 'gone'].includes(presence[agent.id] || '')
    const isLead = agent.id === channel.leadAgentId
    return (
      <div
        key={agent.id}
        id={`member-row-${agent.id}`}
        className="group flex items-center gap-2 rounded-lg px-1 py-1.5 transition-colors hover:bg-surface-2/60"
      >
        <BotAvatar agentId={agent.id} name={agent.name} presence={presence[agent.id]} size={22} />
        <button
          type="button"
          disabled={!canManage}
          onClick={() => void openAgentDetail(agent.id)}
          title={canManage ? `查看 ${agent.name} 的人设与内部提示词` : '当前后端不支持查看人设'}
          className="min-w-0 flex-1 text-left disabled:cursor-default"
        >
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
        </button>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {canManage && (
            <button
              type="button"
              id={`member-detail-${agent.id}`}
              title="查看详情与人设"
              onClick={() => void openAgentDetail(agent.id)}
              className="grid size-6 place-items-center rounded text-ink-4 transition-colors hover:bg-surface-3 hover:text-ink-2"
            >
              <Info className="size-3.5" />
            </button>
          )}
          {!isLead && (
            <button
              type="button"
              id={`member-lead-${agent.id}`}
              title="设为组长"
              disabled={!canManage || leadSaving}
              onClick={() => void setLead(agent.id)}
              className="grid size-6 place-items-center rounded text-ink-4 transition-colors hover:bg-surface-3 hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Crown className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            id={`member-mute-${agent.id}`}
            title={muted ? '取消静音' : '静音'}
            onClick={() => void toggleMute(agent.id, !muted)}
            className={cn(
              'grid size-6 place-items-center rounded transition-colors hover:bg-surface-3 hover:text-ink-2',
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
              className="grid size-6 place-items-center rounded text-ink-4 transition-colors hover:bg-surface-3 hover:text-ink-2"
            >
              <RotateCw className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            id={`member-remove-${agent.id}`}
            title={removeHint}
            disabled={!canRemove}
            onClick={() => void removeMember(agent.id)}
            className="grid size-6 place-items-center rounded text-ink-4 transition-colors hover:bg-surface-3 hover:text-err disabled:cursor-not-allowed disabled:opacity-35"
          >
            <UserMinus className="size-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <Popover open={membersOpen} onOpenChange={setMembersOpen}>
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
      <PopoverContent id="channel-members-panel" align="end" className="w-[340px] p-2">
        {addOpen ? (
          <>
            <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-0.5">
              <button
                type="button"
                onClick={closeAddMembers}
                className="grid size-6 place-items-center rounded text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                title="返回成员列表"
              >
                <ArrowLeft className="size-3.5" />
              </button>
              <span className="text-[12px] font-medium text-ink">添加成员</span>
              <span id="member-add-count" className="ml-auto font-mono text-[10.5px] text-ink-4">
                {channel.memberAgentIds.length + candidateIds.length}/{channelMaxMembers}
              </span>
            </div>

            <div className="px-1 pb-1.5 text-[10.5px] leading-4 text-ink-4">
              {room <= 0
                ? `频道已满（上限 ${channelMaxMembers} 个），先移出一位再加`
                : `还能添加 ${room} 个智能体；已选 ${candidateIds.length} 个`}
            </div>

            <div className="max-h-64 overflow-y-auto">
              {!candidates.length && (
                <div className="px-2 py-6 text-center text-[11px] leading-5 text-ink-4">
                  名册里的智能体都已在频道里。
                  <br />
                  返回上一层可以「新建智能体」。
                </div>
              )}
              {candidates.map((agent) => {
                const picked = candidateIds.includes(agent.id)
                const atCap = !picked && candidateIds.length >= room
                return (
                  <button
                    key={agent.id}
                    id={`member-add-candidate-${agent.id}`}
                    type="button"
                    aria-pressed={picked}
                    disabled={room <= 0 || atCap}
                    onClick={() => toggleCandidate(agent.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      picked ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                      (room <= 0 || atCap) && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors',
                        picked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                      )}
                    >
                      {picked && <Check className="size-3" />}
                    </span>
                    <BotAvatar agentId={agent.id} name={agent.name} presence={presence[agent.id]} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{agent.name}</span>
                      <span className="block truncate text-[10.5px] text-ink-4">
                        {[agent.title, agent.model].filter(Boolean).join(' · ') || '未填写角色'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-2 flex items-center gap-2 border-t border-border/70 px-1 pt-2">
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-4">
                {room <= 0 ? '已达成员上限' : '确认后保存，成员立即可被 @'}
              </span>
              <button
                type="button"
                onClick={closeAddMembers}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-surface-2"
              >
                取消
              </button>
              <button
                type="button"
                id="member-add-confirm"
                disabled={!candidateIds.length || membersSaving || room <= 0}
                onClick={() => void addMembers()}
                className="inline-flex min-w-14 items-center justify-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {membersSaving && <Loader2 className="size-3 animate-spin" />}
                {membersSaving ? '保存中…' : '添加'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-2 px-1 pb-1.5 pt-0.5">
              <span className="text-[12px] font-medium text-ink">成员</span>
              <span className="font-mono text-[10.5px] text-ink-4">
                {channel.memberAgentIds.length}/{channelMaxMembers}
              </span>
              {overflow && <span className="text-[10.5px] text-warn">超过上限</span>}
            </div>

            {lead ? (
              <div className="mb-1 rounded-lg bg-surface-2/70 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <BotAvatar agentId={lead.id} name={lead.name} presence={presence[lead.id]} size={22} />
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => void openAgentDetail(lead.id)}
                    className="min-w-0 truncate text-[12px] text-ink hover:underline disabled:cursor-default disabled:no-underline"
                  >
                    {lead.name}
                  </button>
                  <span className="rounded-[3px] border border-primary/35 px-1 text-[9.5px] leading-4 text-primary">
                    组长
                  </span>
                  <button
                    type="button"
                    id="member-clear-lead"
                    disabled={!canManage || leadSaving}
                    onClick={() => void setLead(null)}
                    title="取消组长，回到用户编排"
                    className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 text-[10.5px] text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {leadSaving ? '保存中…' : '取消组长'}
                  </button>
                </div>
                <div className="mt-1 text-[10.5px] leading-4 text-ink-4">
                  负责派单、催办和最终收口；取消后回到用户编排。
                </div>
              </div>
            ) : (
              <div className="mb-1 rounded-lg bg-surface-2/70 px-2 py-1.5 text-[10.5px] leading-4 text-ink-4">
                没有组长，由用户负责编排：只有被 @ 的成员会被唤醒。
              </div>
            )}

            <div className="max-h-64 overflow-y-auto">{ordered.map(renderRow)}</div>

            <div className="mt-1 flex items-center gap-1.5 border-t border-border/70 px-1 pt-2">
              <button
                type="button"
                id="member-open-add"
                disabled={!canManage || room <= 0}
                onClick={() => void openAddMembers()}
                title={!canManage ? '当前后端不支持改成员' : room <= 0 ? '频道已满' : '从名册添加成员'}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <UserPlus className="size-3.5" />
                添加成员
              </button>
              <button
                type="button"
                id="member-new-agent"
                disabled={!canManage}
                onClick={openCreateAgent}
                title="新建一个智能体，并可直接加入当前频道"
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="size-3.5" />
                新建智能体
              </button>
            </div>

            <div className="mt-1 px-1 text-[10.5px] leading-4 text-ink-4">
              {canManage
                ? '点成员名字可查看/编辑人设；移出至少要保留 2 个智能体。'
                : '当前后端只支持静音与重启；升级后可在壳内增删成员与编辑人设。'}
              {orchestrationEnabled && ' 当前 CLI 已开启自动接力，壳只展示该状态。'}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
