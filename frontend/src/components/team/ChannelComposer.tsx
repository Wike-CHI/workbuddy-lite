import { ArrowUp, Plus, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { detectPalette, filterItems, paletteStep, type PaletteState } from '@/components/composer/palette'
import { confirmToast } from '@/lib/confirmToast'
import type { Connector } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'
import { agentsOfChannel, type TeamAgent, type TeamChannel, useTeamStore } from '@/store/team'

import { BotAvatar } from './BotAvatar'

type PaletteItem =
  | { kind: 'all'; name: string; description: string }
  | { kind: 'member'; name: string; description?: string; agent: TeamAgent }
  | { kind: 'connector'; name: string; description?: string; connector: Connector }

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function presenceLabel(value?: string) {
  if (!value || value === 'idle') return '空闲'
  if (value === 'active' || value === 'online') return '在线'
  if (value === 'offline' || value === 'gone') return '离线'
  return '空闲'
}

function AllBadge({ count }: { count: number }) {
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[9px] font-medium text-accent-ink">
      {count}
    </span>
  )
}

export function ChannelComposer({ channel }: { channel: TeamChannel }) {
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const composing = React.useRef(false)
  const [value, setValue] = React.useState('')
  const [palette, setPalette] = React.useState<PaletteState | null>(null)

  const agents = useTeamStore((s) => s.agents)
  const presence = useTeamStore((s) => s.presence)
  const sending = useTeamStore((s) => s.sending)
  const pendingMentions = useTeamStore((s) => s.pendingMentions)
  const mentionSignal = useTeamStore((s) => s.mentionSignal)
  const replyTarget = useTeamStore((s) => s.replyTarget)
  const clearReplyTarget = useTeamStore((s) => s.clearReplyTarget)
  const orchestrationEnabled = useTeamStore((s) => s.orchestrationEnabled)
  const send = useTeamStore((s) => s.send)
  const addMention = useTeamStore((s) => s.addMention)
  const removeMention = useTeamStore((s) => s.removeMention)
  const clearMentions = useTeamStore((s) => s.clearMentions)
  const clearMentionSignal = useTeamStore((s) => s.clearMentionSignal)
  const connectors = useChatStore((s) => s.catalog.connectors)

  const members = React.useMemo(() => agentsOfChannel(channel, agents), [channel, agents])
  const showAll = members.length > 1
  const membersById = React.useMemo(() => new Map(members.map((agent) => [agent.id, agent])), [members])

  const memberItems = React.useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = []
    if (showAll) {
      list.push({ kind: 'all', name: '所有智能体', description: `唤醒本频道 ${members.length} 个智能体` })
    }
    for (const agent of members) {
      list.push({
        kind: 'member',
        name: agent.name,
        description: [agent.title, agent.model].filter(Boolean).join(' · '),
        agent,
      })
    }
    return list
  }, [members, showAll])

  const connectorItems = React.useMemo<PaletteItem[]>(
    () =>
      [...connectors].map((connector) => ({
        kind: 'connector' as const,
        name: connector.name,
        description: connector.description || connector.type || '连接器',
        connector,
      })),
    [connectors],
  )

  const visibleMembers = React.useMemo(() => filterItems(memberItems, palette?.query || ''), [memberItems, palette?.query])
  const visibleConnectors = React.useMemo(
    () => filterItems(connectorItems, palette?.query || ''),
    [connectorItems, palette?.query],
  )
  const flat = React.useMemo(() => [...visibleMembers, ...visibleConnectors], [visibleMembers, visibleConnectors])

  const applyValue = (next: string, caret?: number) => {
    setValue(next)
    if (caret !== undefined) {
      requestAnimationFrame(() => {
        const input = inputRef.current
        if (!input) return
        input.focus()
        input.setSelectionRange(caret, caret)
        input.style.height = 'auto'
        input.style.height = Math.min(144, input.scrollHeight) + 'px'
      })
    }
  }

  const openPalette = (options?: { start?: number; end?: number; query?: string; index?: number }) => {
    const caret = options?.start ?? inputRef.current?.selectionStart ?? value.length
    setPalette({
      mode: 'member',
      query: options?.query || '',
      start: options?.start ?? caret,
      end: options?.end ?? caret,
      index: options?.index ?? 0,
    })
  }

  const pick = (index: number) => {
    if (!palette) return
    const item = flat[index]
    if (!item) {
      setPalette(null)
      return
    }
    const before = value.slice(0, palette.start)
    const after = value.slice(palette.end)
    if (item.kind === 'connector') {
      // 频道消息只有 text + mentionAgentIds，没有连接器参数；不要伪造一个发不出去的引用
      applyValue(before + after, palette.start)
      setPalette(null)
      toast.info('频道消息暂不支持连接器，请在会话里使用 @ 引用连接器')
      return
    }
    const insert = '@' + item.name + ' '
    applyValue(before + insert + after, palette.start + insert.length)
    if (item.kind === 'all') {
      for (const member of members) addMention(member.id)
    } else {
      addMention(item.agent.id)
    }
    setPalette(null)
  }

  // 截图钩子 __wbl.mention(agentId)：打开面板并高亮该成员，方便截「@ 选人」态
  React.useEffect(() => {
    if (!mentionSignal) return
    const index = mentionSignal.agentId
      ? flat.findIndex((item) => item.kind === 'member' && item.agent.id === mentionSignal.agentId)
      : 0
    openPalette({ start: value.length, end: value.length, query: '', index: Math.max(0, index) })
    inputRef.current?.focus()
    clearMentionSignal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionSignal?.nonce])

  const onChange = (next: string, cursor: number) => {
    setValue(next)
    const ctx = detectPalette(next, cursor)
    if (!ctx || ctx.mode !== 'connector') {
      setPalette(null)
      return
    }
    // 频道里 @ 的首组是本频道智能体，连接器放在第二组；mode 仍记为 member
    setPalette({ ...ctx, mode: 'member', index: 0 })
  }

  const doSend = async (text: string) => {
    if (!text.trim() || sending) return
    const result = await send(text)
    if (result.ok) {
      applyValue('', 0)
      setPalette(null)
      clearMentions()
      inputRef.current?.focus()
    } else {
      toast.error(result.error || '发送失败')
    }
  }

  const submit = () => {
    const text = value
    if (!text.trim() || sending) return
    if (allMentioned && members.length > 1) {
      // @all 会唤醒每个成员，每个都是一次完整运行；发送前二次确认
      confirmToast({
        title: `将唤醒全部 ${members.length} 个智能体`,
        description: '每个被 @ 的成员都会产生一次完整运行，确认现在发送？',
        confirmLabel: '发送',
        onConfirm: () => doSend(text),
      })
      return
    }
    void doSend(text)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
    if (palette) {
      const step = paletteStep(event.key, palette.index, flat.length)
      if (step === 'pick') {
        event.preventDefault()
        event.stopPropagation()
        pick(palette.index)
        return
      }
      if (step === 'close') {
        event.preventDefault()
        event.stopPropagation()
        setPalette(null)
        return
      }
      if (typeof step === 'number') {
        event.preventDefault()
        setPalette((prev) => (prev ? { ...prev, index: step } : prev))
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  const resolvedMentions = React.useMemo(() => {
    const chips = pendingMentions
      .map((id) => membersById.get(id))
      .filter((agent): agent is TeamAgent => !!agent)
    if (showAll && chips.length === members.length) {
      return [{ id: 'all', agent: undefined as TeamAgent | undefined, all: true }]
    }
    return chips.map((agent) => ({ id: agent.id, agent, all: false }))
  }, [pendingMentions, membersById, members.length, showAll])

  const allMentioned =
    resolvedMentions.some((chip) => chip.all) ||
    /(?:^|\s)@(all|所有智能体|所有人)(?:\s|$)/i.test(value)

  const removeChip = (id: string, all: boolean) => {
    if (all) {
      clearMentions()
      applyValue(value.replace(/@(所有智能体|all)\s?/g, ''), undefined)
      return
    }
    const agent = membersById.get(id)
    removeMention(id)
    if (agent) applyValue(value.replace(new RegExp(`@${escapeRegExp(agent.name)}\\s?`, 'g'), ''))
  }

  const charCount = [...value].length

  return (
    <div className="shrink-0 px-4 pb-3 pt-2">
      <div className="relative mx-auto w-full max-w-[var(--composer-width)]">
        {palette && (
          <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
            <div className="border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
              本频道智能体优先 · ↑↓ 选择 · Enter 插入 · Esc 关闭
            </div>
            <div className="max-h-[22rem] overflow-y-auto p-1">
              {!flat.length && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">没有匹配的成员或连接器</div>
              )}

              {visibleMembers.length > 0 && (
                <>
                  <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium text-ink-4">本频道智能体</div>
                  {visibleMembers.map((item, index) => {
                    const active = index === palette.index
                    return (
                      <button
                        key={item.kind === 'member' ? item.agent.id : 'all'}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault()
                          pick(index)
                        }}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left',
                          active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                        )}
                      >
                        {item.kind === 'member' ? (
                          <BotAvatar
                            agentId={item.agent.id}
                            name={item.agent.name}
                            presence={presence[item.agent.id]}
                            size={22}
                          />
                        ) : (
                          <AllBadge count={members.length} />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="text-[12.5px] font-medium">@{item.name}</span>
                            {item.kind === 'member' && (
                              <span className="truncate text-[10px] text-muted-foreground">
                                {channel.mutedAgentIds.includes(item.agent.id)
                                  ? '已静音'
                                  : presenceLabel(presence[item.agent.id])}
                              </span>
                            )}
                          </span>
                          <span className="line-clamp-1 text-[11px] text-muted-foreground">
                            {item.description || ''}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </>
              )}

              <div className="my-1 border-t border-border/70" />
              <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium text-ink-4">连接器</div>
              {!visibleConnectors.length && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">
                  {connectors.length ? '没有匹配的连接器' : '还没有安装连接器'}
                </div>
              )}
              {visibleConnectors.map((item, offset) => {
                const index = visibleMembers.length + offset
                const active = index === palette.index
                return (
                  <button
                    key={item.name}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      pick(index)
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left',
                      active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                    )}
                  >
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded bg-muted text-[10px] text-muted-foreground">
                      ⌁
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-[12.5px] font-medium">{item.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">频道内不可用</span>
                      </span>
                      <span className="line-clamp-1 text-[11px] text-muted-foreground">
                        {item.description || ''}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
          <div className="flex items-end gap-2 px-2.5 pt-2">
            <button
              type="button"
              title="提及成员"
              onClick={() => openPalette()}
              className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
            >
              <Plus className="size-4" />
            </button>
            <div className="min-w-0 flex-1">
              {replyTarget && (
                <div className="mb-1.5 flex items-start gap-1.5 rounded-[4px] border-l-2 border-border bg-surface-2/70 px-2 py-1 text-[10.5px] leading-4 text-ink-3">
                  <span className="shrink-0 font-medium text-ink-2">
                    引用{' '}
                    {replyTarget.from === 'user'
                      ? '我'
                      : membersById.get(replyTarget.agentId || '')?.name || '成员'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {replyTarget.text.replace(/\s+/g, ' ').trim()}
                  </span>
                  <button
                    type="button"
                    onClick={clearReplyTarget}
                    title="取消引用"
                    className="shrink-0 text-ink-4 transition-colors hover:text-ink-2"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}
              {resolvedMentions.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {resolvedMentions.map((chip) => (
                    <span
                      key={chip.id}
                      className="inline-flex h-6 max-w-48 items-center gap-1 rounded border border-border bg-surface-2 px-2 text-[11px] text-ink-2"
                    >
                      <span className="truncate">@{chip.all ? '所有智能体' : chip.agent?.name || chip.id}</span>
                      <button type="button" onClick={() => removeChip(chip.id, chip.all)} title="取消提及">
                        <X className="size-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                ref={inputRef}
                value={value}
                rows={1}
                placeholder={sending ? '正在发送…' : `给 ${channel.name} 发消息，@ 提及智能体`}
                onChange={(event) => {
                  onChange(event.target.value, event.target.selectionStart ?? event.target.value.length)
                  event.target.style.height = 'auto'
                  event.target.style.height = Math.min(144, event.target.scrollHeight) + 'px'
                }}
                onClick={(event) =>
                  onChange(value, event.currentTarget.selectionStart ?? value.length)
                }
                onKeyDown={onKeyDown}
                onCompositionStart={() => {
                  composing.current = true
                }}
                onCompositionEnd={(event) => {
                  composing.current = false
                  onChange(event.currentTarget.value, event.currentTarget.selectionStart ?? value.length)
                }}
                className="max-h-36 min-h-10 w-full resize-none border-0 bg-transparent px-1 py-2 text-[13.5px] leading-6 text-foreground outline-none placeholder:text-ink-4"
              />
            </div>
            <div className="flex shrink-0 items-center pb-1">
              <button
                type="button"
                title="发送 (Enter)"
                disabled={!value.trim() || sending}
                onClick={() => void submit()}
                className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 pb-1.5 pt-1 text-[10.5px] text-ink-4">
            <span>{charCount > 0 ? `${charCount} 字` : 'Enter 发送 · Shift+Enter 换行'}</span>
            <span className="flex-1" />
            {allMentioned && members.length > 1 && (
              <span className="shrink-0 text-warn">将唤醒 {members.length} 个智能体</span>
            )}
            {orchestrationEnabled && (
              <span className="truncate" title="这是 CLI 的 orchestration 开关；v1 只展示，不修改">
                自动接力已开启
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
