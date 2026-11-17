import { ArrowLeft, FolderGit2, Loader2, TriangleAlert } from 'lucide-react'
import * as React from 'react'

import { leafOf } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'
import { agentsOfChannel, useTeamStore, type ChannelMessage } from '@/store/team'

import { ChannelComposer } from './ChannelComposer'
import { ChannelLiveRow } from './ChannelLiveRow'
import { ChannelDayDivider, ChannelMessageRow } from './ChannelMessageRow'
import { ChannelMembersPopover } from './ChannelMembersPopover'
import { ChannelSystemEvent } from './ChannelSystemEvent'

function isSystem(message: ChannelMessage) {
  return message.from === 'system' || message.kind === 'system' || message.kind === 'task'
}

function sameDay(a: number, b: number) {
  const first = new Date(a)
  const second = new Date(b)
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

function normPath(value: string) {
  return String(value || '')
    .replace(/\//g, '\\')
    .toLowerCase()
    .replace(/\\+$/, '')
}

export function ChannelView() {
  const activeChannelId = useTeamStore((s) => s.activeChannelId)
  const channels = useTeamStore((s) => s.channels)
  const agents = useTeamStore((s) => s.agents)
  const presence = useTeamStore((s) => s.presence)
  const messages = useTeamStore((s) => s.messages)
  const workingAgentIds = useTeamStore((s) => s.workingAgentIds)
  const loading = useTeamStore((s) => s.loading)
  const loadingMore = useTeamStore((s) => s.loadingMore)
  const hasMore = useTeamStore((s) => s.hasMore)
  const error = useTeamStore((s) => s.error)
  const orchestrationEnabled = useTeamStore((s) => s.orchestrationEnabled)
  const channelMaxMembers = useTeamStore((s) => s.channelMaxMembers)
  const closeChannel = useTeamStore((s) => s.closeChannel)
  const openChannel = useTeamStore((s) => s.openChannel)
  const loadMore = useTeamStore((s) => s.loadMore)
  const cwd = useChatStore((s) => s.cwd)

  const viewport = React.useRef<HTMLDivElement>(null)
  const bottom = React.useRef<HTMLDivElement>(null)
  const lastMessageId = messages.length ? messages[messages.length - 1].id : ''
  const previousLastId = React.useRef(lastMessageId)
  const channel = channels.find((item) => item.id === activeChannelId)
  const members = React.useMemo(() => agentsOfChannel(channel, agents), [channel, agents])
  const byId = React.useMemo(() => new Map(members.map((agent) => [agent.id, agent])), [members])
  const lead = members.find((agent) => agent.id === channel?.leadAgentId)
  const working = workingAgentIds
    .map((id) => byId.get(id))
    .filter((agent): agent is (typeof members)[number] => !!agent)

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      closeChannel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeChannel])

  React.useEffect(() => {
    if (loading) return
    // 只有「最后一条」变化才滚到底：向上翻页是 prepend，不能把阅读位置甩到底部
    if (lastMessageId !== previousLastId.current) {
      previousLastId.current = lastMessageId
      bottom.current?.scrollIntoView({ block: 'end' })
    }
  }, [activeChannelId, loading, lastMessageId])

  const onLoadMore = async () => {
    const element = viewport.current
    if (!element) return
    const previousHeight = element.scrollHeight
    const previousTop = element.scrollTop
    await loadMore()
    requestAnimationFrame(() => {
      const host = viewport.current
      if (!host) return
      host.scrollTop = host.scrollHeight - previousHeight + previousTop
    })
  }

  if (!channel) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
        <div>
          <div className="text-[13.5px] text-ink-2">频道不存在或已被删除</div>
          <button
            type="button"
            onClick={closeChannel}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-[12px] text-ink-2 hover:bg-surface-2"
          >
            返回会话
          </button>
        </div>
      </div>
    )
  }

  const cwdMismatch = !!channel.homeCwd && !!cwd && normPath(channel.homeCwd) !== normPath(cwd)

  return (
    <section id="channel-view" className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex min-h-[56px] shrink-0 items-center gap-2 border-b border-border px-3.5 py-2.5">
        <button
          type="button"
          title="退出频道（Esc）"
          onClick={closeChannel}
          className="grid size-7 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">{channel.name}</h1>
            {orchestrationEnabled && (
              <span
                className="shrink-0 rounded-[3px] bg-warn-soft px-1 text-[9.5px] leading-4 text-warn"
                title="CLI 的 orchestration 已开启：被叫到的成员可以继续 @ 下一位。v1 只展示，不修改该开关。"
              >
                自动接力
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-3">
            <span className="shrink-0 font-mono">
              {channel.memberAgentIds.length}/{channelMaxMembers} 成员
            </span>
            <span className="shrink-0 text-ink-4">·</span>
            <span className="truncate">{lead ? `组长 ${lead.name}` : '用户负责编排'}</span>
            {channel.homeCwd && (
              <>
                <span className="shrink-0 text-ink-4">·</span>
                <span
                  className={cn('flex min-w-0 items-center gap-0.5', cwdMismatch && 'text-warn')}
                  title={
                    cwdMismatch
                      ? `频道工作目录：${channel.homeCwd}\n与当前工作空间不同，bot 改的是这个目录`
                      : channel.homeCwd
                  }
                >
                  {cwdMismatch ? <TriangleAlert className="size-3 shrink-0" /> : <FolderGit2 className="size-3 shrink-0" />}
                  <span className="truncate font-mono text-[10.5px]">{leafOf(channel.homeCwd)}</span>
                </span>
              </>
            )}
          </div>
        </div>
        <ChannelMembersPopover channel={channel} />
      </header>

      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-warn-soft/60 px-4 py-1.5 text-[11px] text-warn">
          <TriangleAlert className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={error}>
            {error}
          </span>
          <button
            type="button"
            onClick={() => void openChannel(channel.id)}
            className="shrink-0 rounded border border-warn/30 px-1.5 py-0.5 text-[10.5px] hover:bg-warn-soft"
          >
            重试
          </button>
        </div>
      )}

      <div ref={viewport} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[800px] flex-col gap-2.5 px-4 py-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-ink-3">
              <Loader2 className="size-3.5 animate-spin" />
              正在载入频道…
            </div>
          )}

          {!loading && hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void onLoadMore()}
                className="rounded-full border border-border px-3 py-1 text-[11px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2 disabled:opacity-50"
              >
                {loadingMore ? '载入更早消息…' : '载入更早消息'}
              </button>
            </div>
          )}

          {!loading &&
            messages.map((message, index) => {
              const previous = index > 0 ? messages[index - 1] : undefined
              const divider = !previous || !sameDay(previous.at, message.at)
              if (isSystem(message)) {
                return (
                  <React.Fragment key={message.id}>
                    {divider && <ChannelDayDivider at={message.at} />}
                    <ChannelSystemEvent text={message.text} at={message.at} />
                  </React.Fragment>
                )
              }
              const startOfRun =
                !previous ||
                isSystem(previous) ||
                previous.from !== message.from ||
                previous.agentId !== message.agentId
              return (
                <React.Fragment key={message.id}>
                  {divider && <ChannelDayDivider at={message.at} />}
                  <ChannelMessageRow
                    message={message}
                    agent={message.agentId ? byId.get(message.agentId) : undefined}
                    presence={message.agentId ? presence[message.agentId] : undefined}
                    members={members}
                    startOfRun={startOfRun}
                  />
                </React.Fragment>
              )
            })}

          {!loading && !messages.length && (
            <div className="py-14 text-center">
              <div className="text-[13.5px] font-medium text-ink-2">给「{channel.name}」发第一条</div>
              <div className="mt-1 text-[11.5px] text-ink-4">
                输入 @ 选择成员；只有被 @ 的智能体会被唤醒
              </div>
            </div>
          )}

          {!loading && working.length > 0 && <ChannelLiveRow agents={working} />}
          <div ref={bottom} className="h-1" />
        </div>
      </div>

      <ChannelComposer key={channel.id} channel={channel} />
    </section>
  )
}
