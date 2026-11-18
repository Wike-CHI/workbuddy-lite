import { ArrowLeft, ArrowDown, FolderGit2, Loader2, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

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
  const newCount = useTeamStore((s) => s.newCount)
  const highlightId = useTeamStore((s) => s.highlightId)
  const jumpSignal = useTeamStore((s) => s.jumpSignal)
  const markRead = useTeamStore((s) => s.markRead)
  const noteAtBottom = useTeamStore((s) => s.noteAtBottom)
  const noteFocus = useTeamStore((s) => s.noteFocus)
  const quoteMessage = useTeamStore((s) => s.quoteMessage)
  const requestJump = useTeamStore((s) => s.requestJump)
  const consumeJump = useTeamStore((s) => s.consumeJump)
  const setHighlight = useTeamStore((s) => s.setHighlight)
  const cwd = useChatStore((s) => s.cwd)

  const viewport = React.useRef<HTMLDivElement>(null)
  const bottom = React.useRef<HTMLDivElement>(null)
  const atBottomRef = React.useRef(true)
  // atBottom 进 state 是为了让「回到最新」按滚动位置出现；ref 供事件回调即时判断
  const [atBottom, setAtBottom] = React.useState(true)
  const lastMessageId = messages.length ? messages[messages.length - 1].id : ''
  const previousLastId = React.useRef(lastMessageId)
  const channel = channels.find((item) => item.id === activeChannelId)
  const members = React.useMemo(() => agentsOfChannel(channel, agents), [channel, agents])
  // 用整份名册而不是当前成员：移出成员后，它过去发的消息仍应显示名字与头像
  const byId = React.useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
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
    const onBlur = () => noteFocus(false)
    const onFocus = () => noteFocus(true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [noteFocus])

  // 重新打开/重新载入同一个频道时，最后一条 id 可能没变；靠 loading 翻转重置，
  // 否则第二次进入不会滚到底（会被误判成「用户正在看历史」）。
  React.useEffect(() => {
    if (!loading) return
    previousLastId.current = ''
    atBottomRef.current = true
  }, [loading])

  React.useEffect(() => {
    if (loading) return
    // 只有「最后一条」变化才滚到底：向上翻页是 prepend，不能把阅读位置甩到底部。
    // 用户翻到上面看历史时也不要抢滚动，新消息交给「N 条新消息」浮条。
    if (lastMessageId !== previousLastId.current) {
      const latest = messages[messages.length - 1]
      previousLastId.current = lastMessageId
      // 只为自己刚发出、还没被服务端回声替换的消息让路；别人发的用户消息不应抢滚动
      if (atBottomRef.current || latest?.pending) {
        bottom.current?.scrollIntoView({ block: 'end' })
      }
    }
  }, [activeChannelId, loading, lastMessageId, messages])

  // 引用跳转：目标不在当前分页里就自动往前翻几页，找到后居中并短暂高亮
  React.useEffect(() => {
    if (!jumpSignal) return
    let cancelled = false
    const run = async () => {
      const elementId = `channel-msg-${jumpSignal.id}`
      let target = document.getElementById(elementId)
      let attempts = 0
      while (!target && attempts < 5) {
        const state = useTeamStore.getState()
        if (!state.hasMore || state.loadingMore || !state.before) break
        await state.loadMore()
        await new Promise((resolve) => requestAnimationFrame(resolve))
        if (cancelled) return
        target = document.getElementById(elementId)
        attempts += 1
      }
      if (cancelled) return
      if (!target) {
        consumeJump()
        toast.info('原消息不在当前视图，向上翻一翻')
        return
      }
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setHighlight(jumpSignal.id)
      // 滚动与高亮都落下后再清信号：先清会让 effect 重跑并提前 cancel
      consumeJump()
      window.setTimeout(() => {
        if (useTeamStore.getState().highlightId === jumpSignal.id) setHighlight(null)
      }, 1800)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [jumpSignal, consumeJump, setHighlight])

  const onLoadMore = async () => {
    // 滚动事件会连续触发；loadMore 内部虽然会去重，但这里的滚动位置补偿不能重复执行
    const state = useTeamStore.getState()
    if (state.loadingMore || !state.hasMore || !state.before) return
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

  const byMessageId = React.useMemo(
    () => new Map(messages.map((item) => [item.id, item])),
    [messages],
  )
  const authorOf = (message: ChannelMessage) => {
    if (message.from === 'user') return '我'
    return (message.agentId && byId.get(message.agentId)?.name) || '成员'
  }

  const onScroll = () => {
    const element = viewport.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    const next = distance < 48
    if (next !== atBottomRef.current) {
      atBottomRef.current = next
      setAtBottom(next)
      noteAtBottom(next)
    }
    // 上滑到顶部附近自动续页；loadMore 内部有 hasMore / loadingMore 保护
    if (element.scrollTop < 72) void onLoadMore()
  }

  const jumpToLatest = () => {
    // 直接设 scrollTop 而不是 smooth：markRead 引起的重渲染会打断平滑滚动，
    // 结果停在原地、浮条又冒出来（实测）。瞬时到底更可靠。
    const host = viewport.current
    if (host) host.scrollTop = host.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
    void markRead()
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

      <div className="relative min-h-0 flex-1">
        <div id="channel-thread" ref={viewport} onScroll={onScroll} className="h-full overflow-y-auto">
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
                const quotedMessage = message.replyTo ? byMessageId.get(message.replyTo) : undefined
                return (
                  <React.Fragment key={message.id}>
                    {divider && <ChannelDayDivider at={message.at} />}
                    <ChannelMessageRow
                      message={message}
                      agent={message.agentId ? byId.get(message.agentId) : undefined}
                      presence={message.agentId ? presence[message.agentId] : undefined}
                      members={agents}
                      startOfRun={startOfRun}
                      quoted={
                        quotedMessage
                          ? { text: quotedMessage.text, author: authorOf(quotedMessage) }
                          : undefined
                      }
                      quotedMissing={!!message.replyTo && !quotedMessage}
                      highlighted={highlightId === message.id}
                      onQuote={() => quoteMessage(message)}
                      onJump={requestJump}
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

        {(newCount > 0 || !atBottom) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background/90 to-transparent pb-2.5 pt-8">
            <button
              id="channel-jump-latest"
              type="button"
              onClick={jumpToLatest}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-popover/95 px-3 py-1.5 text-[11.5px] text-ink-2 shadow-lg backdrop-blur transition-colors hover:bg-surface-2"
            >
              {newCount > 0 ? `${newCount} 条新消息` : '回到最新'}
              <ArrowDown className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      <ChannelComposer key={channel.id} channel={channel} />
    </section>
  )
}
