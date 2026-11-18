import { create } from 'zustand'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import { markUiState } from '@/lib/uiState'

// 群聊数据全部来自本机 CLI 的 agent-home；壳里不建消息库，也不维护 bot 名册。
// activeChannelId 与 chat.activeId 是两套语义：前者是频道，后者是 ACP 会话。

export interface TeamAgent {
  id: string
  name: string
  avatarVariant?: number
  title?: string
  model?: string
  permissionMode?: string
  homeCwd?: string
  lastActiveAt?: number
  // 只有详情接口才带；列表态刻意不返回（可达 2000 字）
  description?: string
  engine?: string
  visibility?: string
  createdBy?: string
}

export interface TeamChannel {
  id: string
  name: string
  memberAgentIds: string[]
  leadAgentId: string
  mutedAgentIds: string[]
  lastPreview: string
  lastActiveAt: number
  unreadByUser: number
  homeCwd: string
  // 写成员/组长时回传，避免覆盖网页端刚做的改动
  governanceRevision?: number
}

export interface ChannelSystemEvent {
  type?: string
  reason?: string
  names?: string[]
}

export interface ChannelMessage {
  id: string
  at: number
  from: 'user' | 'agent' | 'system' | string
  text: string
  agentId?: string
  mentionAgentIds?: string[]
  kind?: string
  systemEvent?: ChannelSystemEvent
  taskId?: string
  taskEvent?: string
  // CLI 消息模型原生字段：被引用消息的 id；渲染时按当前已加载的消息解析
  replyTo?: string
  pending?: boolean
}

export interface ReplyTarget {
  id: string
  from: string
  agentId?: string
  text: string
  at: number
}

interface JumpSignal {
  id: string
  nonce: number
}

interface MentionSignal {
  agentId?: string
  nonce: number
}

interface TeamState {
  enabled: boolean
  canCreate: boolean
  canManage: boolean
  canRead: boolean
  ready: boolean
  orchestrationEnabled: boolean
  channelMaxMembers: number
  defaultAgentId: string
  agents: TeamAgent[]
  channels: TeamChannel[]
  presence: Record<string, string>
  activeChannelId: string | null
  messages: ChannelMessage[]
  hasMore: boolean
  before: string
  lastSeq: number
  sending: boolean
  // 未读：newCount 只统计「当前频道里、不在底部/窗口失焦时」新到的消息；
  // 侧栏数字来自后端 /api/team/unread（本地游标 + CLI unreadByUser 迁移初值）。
  newCount: number
  replyTarget: ReplyTarget | null
  highlightId: string | null
  jumpSignal: JumpSignal | null
  creating: boolean
  createOpen: boolean
  loading: boolean
  loadingMore: boolean
  error: string
  pendingMentions: string[]
  workingAgentIds: string[]
  mentionSignal: MentionSignal | null
  // v2 成员/人设：面板开合、候选、详情、保存中。写操作全部毫秒级，不走 job。
  membersOpen: boolean
  addMembersOpen: boolean
  candidateIds: string[]
  membersSaving: boolean
  leadSaving: boolean
  detailAgentId: string | null
  detailAgent: TeamAgent | null
  detailError: string
  detailLoading: boolean
  savingAgent: boolean
  createAgentOpen: boolean
  creatingAgent: boolean

  loadState: () => Promise<void>
  openChannel: (id: string) => Promise<void>
  closeChannel: () => void
  loadMore: () => Promise<void>
  markRead: (channelId?: string) => Promise<void>
  noteAtBottom: (atBottom: boolean) => void
  noteFocus: (focused: boolean) => void
  quoteMessage: (message: ReplyTarget) => void
  clearReplyTarget: () => void
  requestJump: (id: string) => void
  consumeJump: () => void
  setHighlight: (id: string | null) => void
  startUnreadPoll: () => void
  stopUnreadPoll: () => void
  send: (text: string) => Promise<{ ok: boolean; error?: string }>
  createChannel: (input: {
    name: string
    memberAgentIds: string[]
    leadAgentId?: string
  }) => Promise<{ ok: boolean; error?: string }>
  openCreate: () => void
  closeCreate: () => void
  toggleMute: (agentId: string, muted: boolean) => Promise<void>
  restartAgent: (agentId: string) => Promise<void>
  openMembers: () => Promise<void>
  setMembersOpen: (open: boolean) => void
  openAddMembers: (agentId?: string) => Promise<void>
  closeAddMembers: () => void
  toggleCandidate: (agentId: string) => void
  addMembers: () => Promise<{ ok: boolean; error?: string }>
  removeMember: (agentId: string) => Promise<{ ok: boolean; error?: string }>
  setLead: (agentId: string | null) => Promise<{ ok: boolean; error?: string }>
  openAgentDetail: (agentId: string) => Promise<void>
  closeAgentDetail: () => void
  saveAgent: (input: {
    id: string
    name: string
    title: string
    description: string
  }) => Promise<{ ok: boolean; error?: string }>
  openCreateAgent: () => void
  closeCreateAgent: () => void
  createAgent: (input: {
    name: string
    title: string
    description: string
    model: string
    joinChannel: boolean
  }) => Promise<{ ok: boolean; error?: string; warning?: string }>
  addMention: (agentId: string) => void
  removeMention: (agentId: string) => void
  clearMentions: () => void
  requestMentionPanel: (agentId?: string) => void
  clearMentionSignal: () => void
  applyIncoming: (raw: unknown) => void
  setError: (message: string) => void
}

let pollToken = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryCount = 0
let unreadTimer: ReturnType<typeof setInterval> | null = null
let readTimer: ReturnType<typeof setTimeout> | null = null
// 频道是否停在底部、窗口是否有焦点：两者任一为假，新消息就计入未读。
// 初值取 true，demo/截图脚本不产生 blur 事件时行为稳定。
let atBottomKnown = true
let focusedKnown = true

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function cleanAgent(raw: unknown): TeamAgent | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = asString(item.id)
  const name = asString(item.name)
  if (!id || !name) return null
  return {
    id,
    name,
    avatarVariant: typeof item.avatarVariant === 'number' ? item.avatarVariant : undefined,
    title: asString(item.title) || undefined,
    model: asString(item.model) || undefined,
    permissionMode: asString(item.permissionMode) || undefined,
    homeCwd: asString(item.homeCwd) || undefined,
    lastActiveAt: typeof item.lastActiveAt === 'number' ? item.lastActiveAt : undefined,
    description: asString(item.description) || undefined,
    engine: asString(item.engine) || undefined,
    visibility: asString(item.visibility) || undefined,
    createdBy: asString(item.createdBy) || undefined,
  }
}

export function cleanChannel(raw: unknown): TeamChannel | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = asString(item.id)
  const name = asString(item.name)
  if (!id || !name) return null
  return {
    id,
    name,
    memberAgentIds: asStringArray(item.memberAgentIds),
    leadAgentId: asString(item.leadAgentId),
    mutedAgentIds: asStringArray(item.mutedAgentIds),
    lastPreview: asString(item.lastPreview),
    lastActiveAt: asNumber(item.lastActiveAt),
    unreadByUser: asNumber(item.unreadByUser),
    homeCwd: asString(item.homeCwd),
    governanceRevision:
      typeof item.governanceRevision === 'number' ? item.governanceRevision : undefined,
  }
}

export function cleanMessage(raw: unknown): ChannelMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = asString(item.id)
  if (!id) return null
  const event = item.systemEvent
  return {
    id,
    at: asNumber(item.at, Date.now()),
    from: asString(item.from, 'user'),
    text: asString(item.text),
    agentId: asString(item.agentId) || undefined,
    mentionAgentIds: asStringArray(item.mentionAgentIds),
    kind: asString(item.kind) || undefined,
    systemEvent:
      event && typeof event === 'object'
        ? {
            type: asString((event as Record<string, unknown>).type) || undefined,
            reason: asString((event as Record<string, unknown>).reason) || undefined,
            names: asStringArray((event as Record<string, unknown>).names),
          }
        : undefined,
    taskId: asString(item.taskId) || undefined,
    taskEvent: asString(item.taskEvent) || undefined,
    replyTo: asString(item.replyTo) || undefined,
  }
}

function upsert(list: ChannelMessage[], message: ChannelMessage): ChannelMessage[] {
  const index = list.findIndex((item) => item.id === message.id)
  if (index >= 0) {
    const next = [...list]
    next[index] = { ...next[index], ...message, pending: false }
    return next
  }
  return [...list, message].sort((a, b) => a.at - b.at)
}

export function agentsOfChannel(channel: TeamChannel | undefined, agents: TeamAgent[]): TeamAgent[] {
  if (!channel) return []
  const map = new Map(agents.map((agent) => [agent.id, agent]))
  return channel.memberAgentIds
    .map((id) => map.get(id))
    .filter((agent): agent is TeamAgent => !!agent)
}

// 文本里的 @名字 也映射成 agentId：用户手打 @评审 和从面板选效果一致，
// 截图钩子 __wbl.teamSend('@评审 …') 因此不需要额外造 mention 状态。
function parseMentionIds(text: string, channel: TeamChannel, agents: TeamAgent[]): string[] {
  const members = agentsOfChannel(channel, agents)
  const ids = new Set<string>()
  if (/(?:^|\s)@(all|所有智能体|所有人)(?:\s|$)/i.test(text)) {
    for (const id of channel.memberAgentIds) ids.add(id)
  }
  for (const agent of members) {
    if (text.includes('@' + agent.name)) ids.add(agent.id)
  }
  return [...ids]
}

export const useTeamStore = create<TeamState>((set, get) => ({
  enabled: false,
  canCreate: false,
  canManage: false,
  canRead: false,
  ready: false,
  orchestrationEnabled: false,
  channelMaxMembers: 12,
  defaultAgentId: '',
  agents: [],
  channels: [],
  presence: {},
  activeChannelId: null,
  messages: [],
  hasMore: false,
  before: '',
  lastSeq: 0,
  sending: false,
  newCount: 0,
  replyTarget: null,
  highlightId: null,
  jumpSignal: null,
  creating: false,
  createOpen: false,
  loading: false,
  loadingMore: false,
  error: '',
  pendingMentions: [],
  workingAgentIds: [],
  mentionSignal: null,
  membersOpen: false,
  addMembersOpen: false,
  candidateIds: [],
  membersSaving: false,
  leadSaving: false,
  detailAgentId: null,
  detailAgent: null,
  detailError: '',
  detailLoading: false,
  savingAgent: false,
  createAgentOpen: false,
  creatingAgent: false,

  loadState: async () => {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    try {
      const state = await api.teamState()
      const presence: Record<string, string> = {}
      for (const item of state.presence || []) {
        if (item && typeof item.agentId === 'string') presence[item.agentId] = String(item.availability || 'idle')
      }
      set({
        ready: true,
        enabled: !!state.enabled,
        // 旧后端没有 /api/team/channel；没有 canCreate 时不显示入口，避免点了才 404
        canCreate: !!state.canCreate,
        // 旧后端没有 v2 写路由；没有 canManage 时成员面板保持只读
        canManage: !!state.canManage,
        // 旧后端没有 /api/team/read；没有 canRead 时只做本地清零，不落盘
        canRead: !!state.canRead,
        orchestrationEnabled: !!state.orchestrationEnabled,
        channelMaxMembers: Number(state.channelMaxMembers || 12),
        defaultAgentId: asString(state.defaultAgentId),
        agents: (state.agents || []).map(cleanAgent).filter((item): item is TeamAgent => !!item),
        channels: (state.channels || [])
          .map(cleanChannel)
          .filter((item): item is TeamChannel => !!item)
          .map((channel) =>
            channel.id === get().activeChannelId ? { ...channel, unreadByUser: 0 } : channel,
          ),
        presence,
        error: state.enabled ? '' : asString(state.reason) || '当前 CodeBuddy 没有可用的频道接口',
      })
      if (state.enabled) {
        retryCount = 0
        // 侧栏未读靠轻量轮询刷新；打开频道时的事件长轮询只覆盖当前频道
        if (state.canRead) get().startUnreadPoll()
      } else if (state.retry && retryCount < 4) {
        // CLI 的 --serve 在后台预热，首屏可能还没起来；最多再试 4 次（2/4/6/8s）
        retryCount += 1
        retryTimer = setTimeout(() => {
          retryTimer = null
          void get().loadState()
        }, 2000 * retryCount)
      }
      if (!state.enabled) get().stopUnreadPoll()
    } catch (error) {
      get().stopUnreadPoll()
      set({
        ready: true,
        enabled: false,
        error: '读取团队失败：' + (error instanceof Error ? error.message : String(error)),
      })
    }
  },

  openChannel: async (id) => {
    const channel = get().channels.find((item) => item.id === id)
    if (!channel) return
    // 直接切到另一个频道也视为离开上一个频道，和 closeChannel 的已读口径保持一致
    const previous = get().activeChannelId
    if (previous && previous !== id) void get().markRead(previous)
    const token = ++pollToken
    set({
      activeChannelId: id,
      messages: [],
      hasMore: false,
      before: '',
      lastSeq: 0,
      loading: true,
      loadingMore: false,
      sending: false,
      error: '',
      pendingMentions: [],
      workingAgentIds: [],
      mentionSignal: null,
      membersOpen: false,
      addMembersOpen: false,
      candidateIds: [],
      membersSaving: false,
      leadSaving: false,
      newCount: 0,
      replyTarget: null,
      highlightId: null,
      jumpSignal: null,
      // 打开即清零，并上报 /api/team/read 推进游标（CLI 可用时顺手清 unreadByUser）
      channels: get().channels.map((item) =>
        item.id === id ? { ...item, unreadByUser: 0 } : item,
      ),
    })
    atBottomKnown = true
    markUiState({ activeChannelId: id })
    try {
      const page = await api.teamMessages(id)
      if (get().activeChannelId !== id || token !== pollToken) return
      const messages = (page.messages || [])
        .map(cleanMessage)
        .filter((item): item is ChannelMessage => !!item)
        .sort((a, b) => a.at - b.at)
      set({ messages, hasMore: !!page.hasMore, before: page.before || '', loading: false })
      void get().markRead(id)
      void pollChannel(id, token)
    } catch (error) {
      if (get().activeChannelId !== id) return
      set({
        loading: false,
        error: '读取频道失败：' + (error instanceof Error ? error.message : String(error)),
      })
    }
  },

  closeChannel: () => {
    const current = get().activeChannelId
    // 离开频道视为已读：避免在频道内看过的新消息，回到侧栏又冒红点
    if (current) void get().markRead(current)
    pollToken += 1
    atBottomKnown = true
    set({
      activeChannelId: null,
      messages: [],
      hasMore: false,
      before: '',
      lastSeq: 0,
      loading: false,
      loadingMore: false,
      sending: false,
      error: '',
      pendingMentions: [],
      workingAgentIds: [],
      mentionSignal: null,
      membersOpen: false,
      addMembersOpen: false,
      candidateIds: [],
      newCount: 0,
      replyTarget: null,
      highlightId: null,
      jumpSignal: null,
    })
    markUiState({ activeChannelId: '' })
  },

  loadMore: async () => {
    const { activeChannelId, before, hasMore, loadingMore } = get()
    if (!activeChannelId || !hasMore || !before || loadingMore) return
    set({ loadingMore: true })
    try {
      const page = await api.teamMessages(activeChannelId, before)
      if (get().activeChannelId !== activeChannelId) return
      const older = (page.messages || [])
        .map(cleanMessage)
        .filter((item): item is ChannelMessage => !!item)
      const seen = new Set(get().messages.map((item) => item.id))
      const merged = [...older.filter((item) => !seen.has(item.id)), ...get().messages].sort(
        (a, b) => a.at - b.at,
      )
      set({
        messages: merged,
        hasMore: !!page.hasMore,
        before: page.before || '',
        loadingMore: false,
      })
    } catch (error) {
      set({
        loadingMore: false,
        error: '加载更早消息失败：' + (error instanceof Error ? error.message : String(error)),
      })
    }
  },

  markRead: async (channelId) => {
    const state = get()
    const id = channelId || state.activeChannelId
    if (!id) return
    if (readTimer) {
      clearTimeout(readTimer)
      readTimer = null
    }
    set({
      channels: get().channels.map((item) =>
        item.id === id ? { ...item, unreadByUser: 0 } : item,
      ),
      ...(get().activeChannelId === id ? { newCount: 0 } : {}),
    })
    // 旧后端没有 /api/team/read：只清本地，重启后按 CLI 的字段重来
    if (!state.canRead) return
    try {
      await api.teamRead(id)
    } catch {
      // 上报失败不影响本地已读；下一次打开会再推进一次游标
    }
  },

  noteAtBottom: (value) => {
    if (atBottomKnown === value) return
    atBottomKnown = value
    if (!value || !get().activeChannelId) return
    // 回到底部即视为读完
    scheduleMarkRead(300)
  },

  noteFocus: (value) => {
    if (focusedKnown === value) return
    focusedKnown = value
    if (!value) return
    if (get().activeChannelId && atBottomKnown) scheduleMarkRead(300)
  },

  quoteMessage: (message) => set({ replyTarget: message }),

  clearReplyTarget: () => set({ replyTarget: null }),

  requestJump: (id) => set({ jumpSignal: { id, nonce: Date.now() } }),

  consumeJump: () => set({ jumpSignal: null }),

  setHighlight: (id) => set({ highlightId: id }),

  startUnreadPoll: () => {
    if (unreadTimer) return
    // 4s 一次轻量轮询；后端顺带做增量扫描，返回每条频道一个数字
    unreadTimer = setInterval(() => {
      void pollUnread()
    }, 4000)
  },

  stopUnreadPoll: () => {
    if (unreadTimer) clearInterval(unreadTimer)
    unreadTimer = null
  },

  send: async (text) => {
    const raw = text.trim()
    const { activeChannelId, channels, agents, pendingMentions, replyTarget } = get()
    if (!activeChannelId) return { ok: false, error: '没有打开的频道' }
    if (!raw) return { ok: false, error: '消息为空' }
    const channel = channels.find((item) => item.id === activeChannelId)
    if (!channel) return { ok: false, error: '频道不存在' }

    const mentioned = new Set([...pendingMentions, ...parseMentionIds(raw, channel, agents)])
    const mentionAgentIds = [...mentioned].filter((id) => channel.memberAgentIds.includes(id))
    // 静音成员不会被 CLI 唤醒，别为它们挂「正在处理」
    const awakeAgentIds = mentionAgentIds.filter((id) => !channel.mutedAgentIds.includes(id))
    const replyTo = replyTarget?.id
    const at = Date.now()
    const local: ChannelMessage = {
      id: `local-${at}-${Math.random().toString(36).slice(2, 6)}`,
      at,
      from: 'user',
      text: raw,
      mentionAgentIds,
      ...(replyTo ? { replyTo } : {}),
      pending: true,
    }
    set({
      messages: upsert(get().messages, local),
      sending: true,
      pendingMentions: [],
      workingAgentIds: awakeAgentIds,
      error: '',
      channels: get().channels.map((item) =>
        item.id === activeChannelId
          ? { ...item, lastPreview: raw.slice(0, 120), lastActiveAt: at }
          : item,
      ),
    })

    try {
      const result = await api.teamSend({
        channelId: activeChannelId,
        text: raw,
        mentionAgentIds,
        ...(replyTo ? { replyTo } : {}),
      })
      if (!result.ok) {
        set({
          messages: get().messages.filter((item) => item.id !== local.id),
          sending: false,
          workingAgentIds: [],
          // 发送失败时文字还在输入框里，@ 芯片和引用目标也一起还原，避免用户重打
          pendingMentions,
          replyTarget,
        })
        return { ok: false, error: result.error || '发送失败' }
      }
      const message = cleanMessage(result.message)
      let messages = get().messages.filter((item) => item.id !== local.id)
      if (message) messages = upsert(messages, message)
      set({ messages, sending: false, replyTarget: null })
      if (result.warning) toast.warning(result.warning)
      if (mentionAgentIds.length) {
        // 兜底：CLI 没有产生结束事件时，90s 后收起「正在处理」，避免无限转圈
        setTimeout(() => {
          const state = get()
          if (state.activeChannelId !== activeChannelId) return
          set({
            workingAgentIds: state.workingAgentIds.filter((id) => !mentionAgentIds.includes(id)),
          })
        }, 90_000)
      }
      return { ok: true }
    } catch (error) {
      set({
        messages: get().messages.filter((item) => item.id !== local.id),
        sending: false,
        workingAgentIds: [],
        pendingMentions,
        replyTarget,
      })
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

  createChannel: async (input) => {
    const { agents, channels, channelMaxMembers } = get()
    const name = input.name.trim()
    if (!name) return { ok: false, error: '请填写频道名' }
    // CLI 不校验重名；壳里先拦一次，避免侧栏出现两个一模一样的频道
    if (channels.some((item) => item.name.trim() === name)) {
      return { ok: false, error: '已有同名频道，换个名字' }
    }
    const known = new Set(agents.map((agent) => agent.id))
    const memberAgentIds = [...new Set(input.memberAgentIds)].filter((id) => known.has(id))
    if (memberAgentIds.length < 2) return { ok: false, error: '频道至少需要两个智能体' }
    if (memberAgentIds.length > channelMaxMembers) {
      return { ok: false, error: `最多 ${channelMaxMembers} 个智能体` }
    }
    const leadAgentId =
      input.leadAgentId && memberAgentIds.includes(input.leadAgentId) ? input.leadAgentId : ''

    set({ creating: true })
    try {
      const result = await api.teamCreate({ name, memberAgentIds, leadAgentId })
      if (!result.ok) throw new Error(result.error || '创建频道失败')
      const created = cleanChannel(result.channel)
      if (!created) throw new Error('频道服务没有返回新频道')
      set({ creating: false, createOpen: false, channels: [...get().channels, created] })
      if (result.warning) toast.warning(result.warning)
      toast.success(`已创建「${created.name}」`)
      await get().openChannel(created.id)
      return { ok: true }
    } catch (error) {
      set({ creating: false })
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

  openCreate: () => set({ createOpen: true, creating: false }),
  closeCreate: () => set({ createOpen: false, creating: false }),

  toggleMute: async (agentId, muted) => {
    const { activeChannelId, channels } = get()
    if (!activeChannelId) return
    const channel = channels.find((item) => item.id === activeChannelId)
    if (!channel) return
    const before = channel.mutedAgentIds
    const next = muted ? [...new Set([...before, agentId])] : before.filter((id) => id !== agentId)
    set({
      channels: channels.map((item) =>
        item.id === activeChannelId ? { ...item, mutedAgentIds: next } : item,
      ),
    })
    try {
      const result = await api.teamMember({ channelId: activeChannelId, agentId, muted })
      if (!result.ok) throw new Error(result.error || '静音失败')
      const updated = cleanChannel(result.channel)
      if (updated) {
        // CLI 的 PATCH 响应可能是部分频道对象；只取静音列表，避免把 homeCwd/预览覆盖成空
        set({
          channels: get().channels.map((item) =>
            item.id === updated.id ? { ...item, mutedAgentIds: updated.mutedAgentIds } : item,
          ),
        })
      }
      toast.success(muted ? '已静音该成员' : '已取消静音')
    } catch (error) {
      set({
        channels: get().channels.map((item) =>
          item.id === activeChannelId ? { ...item, mutedAgentIds: before } : item,
        ),
      })
      toast.error(error instanceof Error ? error.message : String(error))
    }
  },

  restartAgent: async (agentId) => {
    try {
      const result = await api.teamRestart(agentId)
      if (!result.ok) throw new Error(result.error || '重启失败')
      toast.success('已重新拉起该成员')
      void get().loadState()
    } catch (error) {
      toast.error('重启失败：' + (error instanceof Error ? error.message : String(error)))
    }
  },

  openMembers: async () => {
    const state = get()
    if (!state.enabled) {
      toast.error('频道服务不可用')
      return
    }
    let channelId = state.activeChannelId
    if (!channelId) {
      channelId = state.channels[0]?.id || null
      if (!channelId) {
        toast.error('还没有频道')
        return
      }
      await state.openChannel(channelId)
    }
    if (!get().channels.some((item) => item.id === channelId)) return
    set({ membersOpen: true, addMembersOpen: false, candidateIds: [] })
  },

  setMembersOpen: (open) =>
    set({
      membersOpen: open,
      ...(open ? {} : { addMembersOpen: false, candidateIds: [] }),
    }),

  openAddMembers: async (agentId) => {
    await get().openMembers()
    const channel = activeChannelOf(get())
    if (!channel) return
    const preselect = agentId && !channel.memberAgentIds.includes(agentId) ? [agentId] : []
    set({ addMembersOpen: true, candidateIds: preselect })
  },

  closeAddMembers: () => set({ addMembersOpen: false, candidateIds: [] }),

  toggleCandidate: (agentId) => {
    const state = get()
    const channel = activeChannelOf(state)
    if (!channel || channel.memberAgentIds.includes(agentId)) return
    if (state.candidateIds.includes(agentId)) {
      set({ candidateIds: state.candidateIds.filter((id) => id !== agentId) })
      return
    }
    const room = state.channelMaxMembers - channel.memberAgentIds.length
    if (state.candidateIds.length >= room) return
    set({ candidateIds: [...state.candidateIds, agentId] })
  },

  addMembers: async () => {
    const state = get()
    const channel = activeChannelOf(state)
    if (!channel) return { ok: false, error: '没有打开的频道' }
    const additions = state.candidateIds.filter((id) => !channel.memberAgentIds.includes(id))
    if (!additions.length) return { ok: false, error: '先选择要添加的成员' }
    const next = [...channel.memberAgentIds, ...additions]
    if (next.length > state.channelMaxMembers) {
      return { ok: false, error: `最多 ${state.channelMaxMembers} 个智能体` }
    }
    return writeMembers(channel.id, next)
  },

  removeMember: async (agentId) => {
    const channel = activeChannelOf(get())
    if (!channel) return { ok: false, error: '没有打开的频道' }
    if (!channel.memberAgentIds.includes(agentId)) return { ok: false, error: '该成员不在频道里' }
    if (channel.memberAgentIds.length <= 2) {
      const message = '频道至少需要两个智能体，不能再移出'
      toast.error(message)
      return { ok: false, error: message }
    }
    return writeMembers(
      channel.id,
      channel.memberAgentIds.filter((id) => id !== agentId),
    )
  },

  setLead: async (agentId) => {
    const state = get()
    const channel = activeChannelOf(state)
    if (!channel || state.leadSaving) return { ok: false, error: '没有打开的频道' }
    if (agentId && !channel.memberAgentIds.includes(agentId)) {
      return { ok: false, error: '组长必须是频道成员' }
    }
    if ((agentId || '') === (channel.leadAgentId || '')) return { ok: true }
    set({ leadSaving: true })
    try {
      const result = await api.teamLead({
        channelId: channel.id,
        leadAgentId: agentId,
        expectedRevision: channel.governanceRevision,
      })
      if (!result.ok) throw new Error(result.error || '修改组长失败')
      const updated = cleanChannel(result.channel)
      set((current) => ({
        leadSaving: false,
        channels: updated
          ? current.channels.map((item) =>
              item.id === updated.id ? { ...item, ...updated } : item,
            )
          : current.channels,
      }))
      const name = state.agents.find((agent) => agent.id === agentId)?.name
      toast.success(agentId ? `已把 ${name || '该成员'} 设为组长` : '已交回用户编排')
      return { ok: true }
    } catch (error) {
      set({ leadSaving: false })
      const message = error instanceof Error ? error.message : String(error)
      toast.error(message)
      return { ok: false, error: message }
    }
  },

  openAgentDetail: async (agentId) => {
    const cached = get().agents.find((agent) => agent.id === agentId) || null
    set({
      detailAgentId: agentId,
      detailAgent: cached,
      detailError: '',
      detailLoading: true,
      savingAgent: false,
    })
    try {
      const result = await api.teamAgent(agentId)
      if (!result.ok) throw new Error(result.error || '读取智能体详情失败')
      const agent = cleanAgent(result.agent)
      if (!agent) throw new Error('频道服务没有返回智能体详情')
      if (get().detailAgentId !== agentId) return
      set({ detailAgent: agent, detailLoading: false })
    } catch (error) {
      if (get().detailAgentId !== agentId) return
      set({
        detailLoading: false,
        detailError: error instanceof Error ? error.message : String(error),
      })
    }
  },

  closeAgentDetail: () =>
    set({
      detailAgentId: null,
      detailAgent: null,
      detailError: '',
      detailLoading: false,
      savingAgent: false,
    }),

  saveAgent: async (input) => {
    const state = get()
    if (!state.canManage) return { ok: false, error: '当前后端不支持编辑智能体' }
    const name = input.name.trim()
    if (!name) return { ok: false, error: '名字不能为空' }
    set({ savingAgent: true })
    try {
      const result = await api.teamUpdateAgent({
        agentId: input.id,
        name,
        title: input.title.trim(),
        description: input.description.trim(),
      })
      if (!result.ok) throw new Error(result.error || '保存失败')
      const agent = cleanAgent(result.agent)
      set((current) => ({
        savingAgent: false,
        detailAgent: agent ?? current.detailAgent,
        agents: agent
          ? current.agents.map((item) => (item.id === agent.id ? { ...item, ...agent } : item))
          : current.agents,
        channels: mergeChannelList(current.channels, result.channels),
      }))
      toast.success('已保存，对该 bot 之后的回复生效')
      return { ok: true }
    } catch (error) {
      set({ savingAgent: false })
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  },

  openCreateAgent: () =>
    set({
      createAgentOpen: true,
      creatingAgent: false,
      membersOpen: false,
      addMembersOpen: false,
      candidateIds: [],
    }),

  closeCreateAgent: () => set({ createAgentOpen: false, creatingAgent: false }),

  createAgent: async (input) => {
    const state = get()
    if (!state.canManage) return { ok: false, error: '当前后端不支持新建智能体' }
    const name = input.name.trim()
    if (!name) return { ok: false, error: '请填写智能体名字' }
    set({ creatingAgent: true })
    try {
      const result = await api.teamCreateAgent({
        name,
        title: input.title.trim(),
        description: input.description.trim(),
        model: input.model || undefined,
      })
      if (!result.ok) throw new Error(result.error || '新建智能体失败')
      const agent = cleanAgent(result.agent)
      if (!agent) throw new Error('频道服务没有返回新智能体')
      set((current) => ({
        creatingAgent: false,
        createAgentOpen: false,
        agents: [...current.agents.filter((item) => item.id !== agent.id), agent],
      }))
      toast.success(`已创建「${agent.name}」`)

      let warning: string | undefined
      const channel = activeChannelOf(get())
      if (input.joinChannel && channel) {
        if (channel.memberAgentIds.length >= get().channelMaxMembers) {
          warning = '智能体已创建，但频道已满，未自动加入'
        } else {
          const joined = await writeMembers(channel.id, [...channel.memberAgentIds, agent.id])
          if (!joined.ok) {
            warning = '智能体已创建，但加入频道失败：' + (joined.error || '未知原因')
          }
        }
      }
      if (warning) toast.warning(warning)
      return { ok: true, warning }
    } catch (error) {
      set({ creatingAgent: false })
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

  addMention: (agentId) => {
    if (!agentId) return
    if (!get().pendingMentions.includes(agentId)) {
      set({ pendingMentions: [...get().pendingMentions, agentId] })
    }
  },

  removeMention: (agentId) => {
    set({ pendingMentions: get().pendingMentions.filter((id) => id !== agentId) })
  },

  clearMentions: () => set({ pendingMentions: [] }),

  requestMentionPanel: (agentId) => set({ mentionSignal: { agentId, nonce: Date.now() } }),

  clearMentionSignal: () => set({ mentionSignal: null }),

  applyIncoming: (raw) => {
    const message = cleanMessage(raw)
    if (!message) return
    const state = get()
    if (!state.activeChannelId) return
    let messages = state.messages
    if (message.from === 'user') {
      const echoIndex = messages.findIndex(
        (item) =>
          item.id.startsWith('local-') &&
          item.text === message.text &&
          Math.abs(item.at - message.at) < 20_000,
      )
      if (echoIndex >= 0) messages = messages.filter((_, index) => index !== echoIndex)
    }
    messages = upsert(messages, message)
    let working = state.workingAgentIds
    if (message.from === 'agent' && message.agentId) {
      working = working.filter((id) => id !== message.agentId)
    }
    if (message.from === 'system' || message.kind === 'system' || message.kind === 'task') {
      working = []
    }
    // 自己的回显不算未读；不在底部或窗口失焦时，别人/系统消息才累计浮条数字
    let newCount = state.newCount
    if (message.from !== 'user') {
      if (!atBottomKnown || !focusedKnown) {
        newCount += 1
      } else {
        scheduleMarkRead()
      }
    }
    set({
      messages,
      workingAgentIds: working,
      newCount,
      error: '',
      channels: state.channels.map((channel) =>
        channel.id === state.activeChannelId
          ? { ...channel, lastPreview: message.text.slice(0, 120), lastActiveAt: message.at }
          : channel,
      ),
    })
  },

  setError: (message) => set({ error: message }),
}))

function activeChannelOf(state: TeamState) {
  return state.channels.find((item) => item.id === state.activeChannelId)
}

// 合并短时间内的多次「已读」，避免一条回复就 PATCH 一次 CLI
function scheduleMarkRead(delay = 800) {
  if (readTimer) clearTimeout(readTimer)
  readTimer = setTimeout(() => {
    readTimer = null
    void useTeamStore.getState().markRead()
  }, delay)
}

// 侧栏未读：后端把「本地游标之后的消息数」算好，前端只做展示
async function pollUnread() {
  const state = useTeamStore.getState()
  if (!state.enabled || !state.canRead) return
  try {
    const res = await api.teamUnread()
    if (!res.enabled || !Array.isArray(res.channels)) return
    const counts = new Map(
      res.channels.map((item) => [item.id, Math.max(0, Number(item.unread) || 0)]),
    )
    useTeamStore.setState((current) => ({
      channels: current.channels.map((channel) =>
        counts.has(channel.id)
          ? { ...channel, unreadByUser: counts.get(channel.id) || 0 }
          : channel,
      ),
    }))
  } catch {
    // 红点刷新失败不打扰用户，下一次继续
  }
}

function mergeChannelList(current: TeamChannel[], raw: unknown): TeamChannel[] {
  if (!Array.isArray(raw)) return current
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const entry of raw) {
    const cleaned = cleanChannel(entry)
    if (!cleaned) continue
    byId.set(cleaned.id, { ...(byId.get(cleaned.id) || cleaned), ...cleaned })
  }
  return current.map((item) => byId.get(item.id) || item)
}

// 成员增删共用一条写路径：全量替换 + expectedRevision，成功后就地更新频道。
async function writeMembers(
  channelId: string,
  memberAgentIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const channel = useTeamStore.getState().channels.find((item) => item.id === channelId)
  if (!channel) return { ok: false, error: '频道不存在' }
  if (memberAgentIds.length < 2) return { ok: false, error: '频道至少需要两个智能体' }
  if (useTeamStore.getState().membersSaving) return { ok: false, error: '正在保存，请稍候' }
  useTeamStore.setState({ membersSaving: true })
  try {
    const result = await api.teamSetMembers({
      channelId,
      memberAgentIds,
      expectedRevision: channel.governanceRevision,
    })
    if (!result.ok) throw new Error(result.error || '修改成员失败')
    const updated = cleanChannel(result.channel)
    useTeamStore.setState((current) => ({
      membersSaving: false,
      addMembersOpen: false,
      candidateIds: [],
      channels: updated
        ? current.channels.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
        : current.channels,
    }))
    toast.success(memberAgentIds.length > channel.memberAgentIds.length ? '已添加成员' : '已移出成员')
    return { ok: true }
  } catch (error) {
    useTeamStore.setState({ membersSaving: false })
    const message = error instanceof Error ? error.message : String(error)
    toast.error(message)
    return { ok: false, error: message }
  }
}

async function pollChannel(channelId: string, token: number) {
  let failures = 0
  while (useTeamStore.getState().activeChannelId === channelId && token === pollToken) {
    try {
      const from = useTeamStore.getState().lastSeq
      const res = await api.teamEvents(channelId, from, 15_000)
      const state = useTeamStore.getState()
      if (state.activeChannelId !== channelId || token !== pollToken) return
      if (res.error) {
        // 后端用 200 包住「CLI 未就绪 / 分页失败」，必须自己退避，否则会立刻再次请求形成忙循环
        failures += 1
        state.setError(res.error)
        if (failures >= 8) {
          state.setError('频道更新已停止，请点「重试」重新连接')
          return
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 800 * failures)))
        continue
      }
      failures = 0
      for (const event of res.events || []) {
        if (event && event.channelId === channelId) state.applyIncoming(event.message)
      }
      if (typeof res.lastSeq === 'number') {
        useTeamStore.setState({ lastSeq: res.lastSeq })
      }
    } catch (error) {
      if (useTeamStore.getState().activeChannelId !== channelId || token !== pollToken) return
      failures += 1
      useTeamStore
        .getState()
        .setError(
          failures > 2
            ? '频道更新暂时中断，正在重试…'
            : '频道更新延迟：' + (error instanceof Error ? error.message : String(error)),
        )
      // 连续失败到 8 次就停，避免断网时无限轮询；用户可点「重试」重新开频道
      if (failures >= 8) {
        useTeamStore.getState().setError('频道更新已停止，请点「重试」重新连接')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 800 * failures)))
    }
  }
}
