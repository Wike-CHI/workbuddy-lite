import { create } from 'zustand'
import { toast } from 'sonner'

import { api } from '@/lib/api'

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
  pending?: boolean
}

interface MentionSignal {
  agentId?: string
  nonce: number
}

interface TeamState {
  enabled: boolean
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
  loading: boolean
  loadingMore: boolean
  error: string
  pendingMentions: string[]
  workingAgentIds: string[]
  mentionSignal: MentionSignal | null

  loadState: () => Promise<void>
  openChannel: (id: string) => Promise<void>
  closeChannel: () => void
  loadMore: () => Promise<void>
  send: (text: string) => Promise<{ ok: boolean; error?: string }>
  toggleMute: (agentId: string, muted: boolean) => Promise<void>
  restartAgent: (agentId: string) => Promise<void>
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
  loading: false,
  loadingMore: false,
  error: '',
  pendingMentions: [],
  workingAgentIds: [],
  mentionSignal: null,

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
      } else if (state.retry && retryCount < 4) {
        // CLI 的 --serve 在后台预热，首屏可能还没起来；最多再试 4 次（2/4/6/8s）
        retryCount += 1
        retryTimer = setTimeout(() => {
          retryTimer = null
          void get().loadState()
        }, 2000 * retryCount)
      }
    } catch (error) {
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
      // 打开即本地清零，不回写 CLI 的 unreadByUser（避免和网页端互相清零）
      channels: get().channels.map((item) =>
        item.id === id ? { ...item, unreadByUser: 0 } : item,
      ),
    })
    try {
      const page = await api.teamMessages(id)
      if (get().activeChannelId !== id || token !== pollToken) return
      const messages = (page.messages || [])
        .map(cleanMessage)
        .filter((item): item is ChannelMessage => !!item)
        .sort((a, b) => a.at - b.at)
      set({ messages, hasMore: !!page.hasMore, before: page.before || '', loading: false })
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
    pollToken += 1
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
    })
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

  send: async (text) => {
    const raw = text.trim()
    const { activeChannelId, channels, agents, pendingMentions } = get()
    if (!activeChannelId) return { ok: false, error: '没有打开的频道' }
    if (!raw) return { ok: false, error: '消息为空' }
    const channel = channels.find((item) => item.id === activeChannelId)
    if (!channel) return { ok: false, error: '频道不存在' }

    const mentioned = new Set([...pendingMentions, ...parseMentionIds(raw, channel, agents)])
    const mentionAgentIds = [...mentioned].filter((id) => channel.memberAgentIds.includes(id))
    // 静音成员不会被 CLI 唤醒，别为它们挂「正在处理」
    const awakeAgentIds = mentionAgentIds.filter((id) => !channel.mutedAgentIds.includes(id))
    const at = Date.now()
    const local: ChannelMessage = {
      id: `local-${at}-${Math.random().toString(36).slice(2, 6)}`,
      at,
      from: 'user',
      text: raw,
      mentionAgentIds,
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
      })
      if (!result.ok) {
        set({
          messages: get().messages.filter((item) => item.id !== local.id),
          sending: false,
          workingAgentIds: [],
          // 发送失败时文字还在输入框里，@ 芯片也一起还原，避免用户重打
          pendingMentions,
        })
        return { ok: false, error: result.error || '发送失败' }
      }
      const message = cleanMessage(result.message)
      let messages = get().messages.filter((item) => item.id !== local.id)
      if (message) messages = upsert(messages, message)
      set({ messages, sending: false })
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
      })
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

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
    set({
      messages,
      workingAgentIds: working,
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
