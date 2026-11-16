import { create } from 'zustand'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import { applyEvent, eventsToMessages } from '@/lib/messages'
import type {
  AcpCommand,
  AcpEvent,
  Attachment,
  Bootstrap,
  Catalog,
  ChatMessage,
  ModelInfo,
  Quota,
  SessionSummary,
  UsageSummary,
  Workspace,
} from '@/lib/types'

const EMPTY_CATALOG: Catalog = { skills: [], connectors: [], plugins: [], marketplaces: [] }
const PREF_KEY = 'wbl.prefs'
const DRAFT_KEY = 'wbl.drafts'

function readPrefs(): { mode?: string; model?: string } {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function readDrafts(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

const drafts = readDrafts()

function saveDrafts() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts))
  } catch {
    // ignore
  }
}

function savePrefs(mode: string, model: string) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ mode, model }))
  } catch {
    // ignore
  }
}

let polling = false
let initPromise: Promise<void> | null = null

function parseMultiplier(credits: string) {
  const hit = String(credits || '').match(/[x×]\s*([\d.]+)/i)
  return hit ? parseFloat(hit[1]) : 0
}

function modelsFromConfig(options: unknown): ModelInfo[] {
  if (!Array.isArray(options)) return []
  return options
    .filter(
      (o): o is { value: string; name?: string; description?: string } =>
        typeof o === 'object' && o !== null && typeof (o as { value?: unknown }).value === 'string',
    )
    .map((o) => {
      const credits = o.description || ''
      return {
        id: o.value,
        name: o.name || o.value,
        credits,
        multiplier: parseMultiplier(credits),
        maxInputTokens: 0,
      }
    })
}

interface ChatState {
  boot: Bootstrap | null
  demo: boolean
  cwd: string
  workspace: string
  agentReady: boolean
  agentError: string
  status: string
  sessions: SessionSummary[]
  projectNames: Record<string, string>
  activeId: string | null
  activeTitle: string
  messages: ChatMessage[]
  running: boolean
  lastSeq: number
  model: string
  mode: string
  modelTouched: boolean
  modeTouched: boolean
  models: ModelInfo[]
  quota: Quota | null
  credits: number
  charged: number
  todayCredits: number
  contextUsed: number
  contextSize: number
  usage: UsageSummary | null
  catalog: Catalog
  commands: AcpCommand[]
  workspaces: Workspace[]
  workspaceId: string
  workspaceName: string
  workspaceFolders: string[]
  attachments: Attachment[]
  connectorRefs: string[]
  history: string[]
  turnCredit: { nominal: number; actual: number } | null

  init: () => Promise<void>
  handleEvent: (ev: AcpEvent) => void
  startPolling: () => void
  loadSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  newSession: () => void
  refreshSessions: () => Promise<void>
  send: (text: string) => Promise<void>
  cancel: () => Promise<void>
  resolvePermission: (requestId: string, optionId: string) => Promise<void>
  setModel: (model: string) => Promise<void>
  setMode: (mode: string) => void
  loadModels: () => Promise<void>
  loadUsage: () => Promise<void>
  loadCatalog: () => Promise<void>
  loadWorkspaces: () => Promise<void>
  useWorkspace: (path: string) => Promise<boolean>
  useWorkspaceById: (id: string) => Promise<boolean>
  applyWorkspace: (payload: { path?: string; id?: string }) => Promise<boolean>
  saveWorkspace: (payload: { id?: string; name: string; folders: string[] }) => Promise<string>
  removeWorkspace: (id: string) => Promise<boolean>
  openWorkspace: (path: string) => Promise<void>
  pickWorkspace: () => Promise<string>
  createWorkspace: (name: string, parent?: string) => Promise<string>
  addAttachment: (attachment: Attachment) => void
  removeAttachment: (index: number) => void
  addConnector: (name: string) => void
  removeConnector: (name: string) => void
  clearComposerExtras: () => void
  getDraft: () => string
  setDraft: (text: string) => void
  clearDraft: () => void
  pushHistory: (text: string) => void
}

export const useChatStore = create<ChatState>()((set, get) => ({
  boot: null,
  demo: false,
  cwd: '',
  workspace: '',
  agentReady: false,
  agentError: '',
  status: '正在启动…',
  sessions: [],
  projectNames: {},
  activeId: null,
  activeTitle: '新会话',
  messages: [],
  running: false,
  lastSeq: 0,
  model: readPrefs().model || '',
  mode: readPrefs().mode || 'fullAccess',
  modelTouched: !!readPrefs().model,
  modeTouched: !!readPrefs().mode,
  models: [],
  quota: null,
  credits: 0,
  charged: 0,
  todayCredits: 0,
  contextUsed: 0,
  contextSize: 0,
  usage: null,
  catalog: EMPTY_CATALOG,
  commands: [],
  workspaces: [],
  workspaceId: '',
  workspaceName: '',
  workspaceFolders: [],
  attachments: [],
  connectorRefs: [],
  history: [],
  turnCredit: null,

  init: async () => {
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        const boot = await api.bootstrap()
        set({
          boot,
          demo: boot.demo,
          cwd: boot.cwd,
          workspace: boot.workspace,
          workspaceId: boot.workspaceId || '',
          workspaceName: boot.workspaceName || boot.workspace,
          workspaceFolders: boot.workspaceFolders || [],
          agentReady: boot.agentReady,
          agentError: boot.agentError,
          status: boot.status,
          sessions: boot.sessions,
          projectNames: boot.projectNames || {},
          lastSeq: boot.lastSeq,
          quota: boot.quota,
          credits: boot.credits,
          charged: boot.charged,
          todayCredits: boot.todayCredits,
          model: boot.model || get().model,
        })
        if (boot.lastSessionId && !boot.fresh) {
          await get().loadSession(boot.lastSessionId)
        } else {
          get().newSession()
        }
        void get().loadModels()
        void get().loadUsage()
        void get().loadCatalog()
        void get().loadWorkspaces()
        get().startPolling()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        set({ status: '无法连接本地服务', agentError: message })
        toast.error('初始化失败：' + message)
      }
    })()
    return initPromise
  },

  startPolling: () => {
    if (polling) return
    polling = true
    const loop = async () => {
      while (polling) {
        try {
          const res = await api.events(get().lastSeq, 10000)
          if (typeof res.lastSeq === 'number' && res.lastSeq < get().lastSeq) {
            set({ lastSeq: 0 })
            continue
          }
          for (const ev of res.events || []) {
            get().handleEvent(ev)
          }
        } catch (error) {
          api.log('poll error ' + (error instanceof Error ? error.message : String(error)))
          await new Promise((resolve) => setTimeout(resolve, 1200))
        }
      }
    }
    void loop()
  },

  handleEvent: (ev: AcpEvent) => {
    const state = get()
    if (!state.activeId && ev.sessionId) {
      set({ activeId: ev.sessionId })
    }
    const activeId = get().activeId
    if (ev.sessionId && activeId && ev.sessionId !== activeId) return

    if (ev.type === 'config') {
      const options = Array.isArray(ev.data.options) ? ev.data.options : []
      const mode = options.find((o: any) => o && o.id === 'mode')
      const model = options.find((o: any) => o && o.id === 'model')
      if (mode) {
        set({
          mode: get().modeTouched ? get().mode : mode.currentValue || get().mode,
        })
      }
      if (model) {
        const list = modelsFromConfig(model.options)
        set({
          models: list.length ? list : get().models,
          model: get().modelTouched ? get().model : model.currentValue || get().model,
        })
      }
    } else if (ev.type === 'models') {
      const list = modelsFromConfig(ev.data.models)
      if (list.length) {
        set({
          models: list,
          model: get().modelTouched ? get().model : ev.data.currentId || get().model,
        })
      }
    } else if (ev.type === 'mode' && ev.data.mode) {
      set({ mode: get().modeTouched ? get().mode : String(ev.data.mode) })
    } else if (ev.type === 'commands') {
      const list = Array.isArray(ev.data.commands) ? ev.data.commands : []
      set({ commands: list as AcpCommand[] })
    }

    set({ messages: applyEvent(get().messages, ev), lastSeq: ev.seq })

    if (ev.type === 'usage') {
      const nominal = Number(ev.data.originalCredit ?? ev.data.credit ?? 0)
      const actual = Number(ev.data.credit ?? 0)
      if (nominal || actual) set({ turnCredit: { nominal, actual } })
      if (ev.data.quota) set({ quota: ev.data.quota as Quota })
      set({ contextUsed: Number(ev.data.used || 0), contextSize: Number(ev.data.size || 0) })
      void get().loadUsage()
    }
    if (ev.type === 'done') {
      set({ running: false })
      void get().refreshSessions()
      void get().loadUsage()
    }
    if (ev.type === 'error' || ev.type === 'auth_required') {
      set({ running: false })
    }
  },

  loadSession: async (id) => {
    try {
      const detail = await api.session(id)
      const history = (detail.events || [])
        .filter((e) => e.type === 'user' && typeof e.data?.text === 'string')
        .map((e) => String(e.data.text))
      set({
        activeId: id,
        activeTitle: detail.title || '新会话',
        messages: eventsToMessages(detail.events || []),
        running: false,
        model: detail.model || get().model,
        mode: detail.mode || get().mode,
        history,
        attachments: [],
        connectorRefs: [],
        turnCredit: null,
        contextUsed: Number(detail.usage?.used || 0),
        contextSize: Number(detail.usage?.size || 0),
      })
    } catch (error) {
      toast.error('读取会话失败：' + (error instanceof Error ? error.message : String(error)))
    }
  },

  renameSession: async (id, title) => {
    const clean = title.trim()
    if (!clean) return
    set({
      sessions: get().sessions.map((s) => (s.id === id ? { ...s, title: clean } : s)),
      activeTitle: get().activeId === id ? clean : get().activeTitle,
    })
    try {
      await api.renameSession(id, clean)
    } catch (error) {
      toast.error('重命名失败：' + (error instanceof Error ? error.message : String(error)))
      void get().refreshSessions()
    }
  },

  deleteSession: async (id) => {
    const wasActive = get().activeId === id
    set({ sessions: get().sessions.filter((s) => s.id !== id) })
    if (wasActive) get().newSession()
    try {
      await api.deleteSession(id)
    } catch (error) {
      toast.error('删除失败：' + (error instanceof Error ? error.message : String(error)))
      void get().refreshSessions()
    }
  },

  newSession: () => {    set({
      activeId: null,
      activeTitle: '新会话',
      messages: [],
      running: false,
      history: [],
      attachments: [],
      connectorRefs: [],
      turnCredit: null,
      contextUsed: 0,
      contextSize: 0,
    })
  },

  refreshSessions: async () => {
    try {
      const boot = await api.bootstrap()
      const current = boot.sessions.find((s) => s.id === get().activeId)
      set({
        sessions: boot.sessions,
        projectNames: boot.projectNames || get().projectNames,
        cwd: boot.cwd || get().cwd,
        workspace: boot.workspace || get().workspace,
        workspaceId: boot.workspaceId || '',
        workspaceName: boot.workspaceName || boot.workspace || get().workspaceName,
        workspaceFolders: boot.workspaceFolders || [],
        quota: boot.quota,
        credits: boot.credits,
        charged: boot.charged,
        todayCredits: boot.todayCredits,
        activeTitle: current?.title || get().activeTitle,
        agentReady: boot.agentReady,
        agentError: boot.agentError,
        status: boot.status,
      })
    } catch {
      // ignore polling races
    }
  },

  send: async (text) => {
    if (get().running) return
    const trimmed = text.replace(/\s+$/, '')
    const images = get().attachments.map((a) => ({ mime: a.mime, data: a.data, name: a.name }))
    if (!trimmed.trim() && !images.length) return
    set({ running: true, turnCredit: null })
    get().pushHistory(trimmed)
    get().clearDraft()
    try {
      const res = await api.chat({
        sessionId: get().activeId || '',
        text: trimmed,
        mode: get().mode,
        model: get().model,
        images,
        connectors: get().connectorRefs.slice(),
      })
      if (res.sessionId) set({ activeId: res.sessionId })
      set({ attachments: [], connectorRefs: [] })
      void get().refreshSessions()
    } catch (error) {
      set({ running: false })
      const message = error instanceof Error ? error.message : String(error)
      toast.error('发送失败：' + message)
    }
  },

  cancel: async () => {
    if (!get().running) return
    try {
      await api.cancel(get().activeId || '')
    } catch {
      // ignore
    }
    set({ running: false })
  },

  resolvePermission: async (requestId, optionId) => {
    set({
      messages: get().messages.map((m) => ({
        ...m,
        parts: m.parts.map((p) =>
          p.type === 'data-permission' && p.data.requestId === requestId
            ? { ...p, data: { ...p.data, resolvedOptionId: optionId } }
            : p,
        ),
      })),
    })
    try {
      await api.permission(requestId, optionId)
    } catch (error) {
      toast.error('授权失败：' + (error instanceof Error ? error.message : String(error)))
    }
  },

  setModel: async (model) => {
    set({ model, modelTouched: true })
    savePrefs(get().mode, model)
    try {
      const res = await api.setModel(model, get().activeId || '')
      if (res.error) toast.error('模型切换失败：' + res.error)
    } catch (error) {
      toast.error('模型切换失败：' + (error instanceof Error ? error.message : String(error)))
    }
  },

  setMode: (mode) => {
    set({ mode, modeTouched: true })
    savePrefs(mode, get().model)
  },

  loadModels: async () => {
    try {
      const res = await api.models()
      if (res.models?.length) {
        set({
          models: res.models,
          model: get().modelTouched ? get().model : res.selected || res.currentId || get().model,
        })
      }
      if (res.quota && res.quota.percent !== undefined) set({ quota: res.quota })
      if (res.error) toast.error('模型目录：' + res.error)
    } catch (error) {
      api.log('models error ' + (error instanceof Error ? error.message : String(error)))
    }
  },

  loadUsage: async () => {
    try {
      const usage = await api.usage()
      set({
        usage,
        quota: usage.quota?.percent !== undefined ? usage.quota : get().quota,
        credits: usage.workspaceCredits || 0,
        charged: usage.workspaceCharged || 0,
        todayCredits: usage.workspaceToday || 0,
      })
    } catch (error) {
      api.log('usage error ' + (error instanceof Error ? error.message : String(error)))
    }
  },

  loadCatalog: async () => {
    try {
      const catalog = await api.catalog()
      set({ catalog })
    } catch (error) {
      api.log('catalog error ' + (error instanceof Error ? error.message : String(error)))
    }
  },

  loadWorkspaces: async () => {
    try {
      const res = await api.workspaces()
      set({ workspaces: res.workspaces || [], cwd: res.cwd || get().cwd, workspace: res.workspace || get().workspace })
    } catch (error) {
      toast.error('读取工作空间失败：' + (error instanceof Error ? error.message : String(error)))
    }
  },

  applyWorkspace: async (payload) => {
    try {
      const res = await api.useWorkspace(payload)
      if (!res.ok) {
        toast.error(res.error || '切换失败')
        return false
      }
      set({
        cwd: res.cwd,
        workspace: res.workspace,
        workspaceId: res.id || '',
        workspaceName: res.workspace,
        workspaceFolders: res.folders || [],
      })
      get().newSession()
      void get().refreshSessions()
      void get().loadWorkspaces()
      void get().loadCatalog()
      void get().loadUsage()
      toast.success('已切换到 ' + res.workspace)
      return true
    } catch (error) {
      toast.error('切换失败：' + (error instanceof Error ? error.message : String(error)))
      return false
    }
  },

  useWorkspace: (path) => get().applyWorkspace({ path }),
  useWorkspaceById: (id) => get().applyWorkspace({ id }),

  saveWorkspace: async (payload) => {
    try {
      const res = await api.saveWorkspace(payload)
      if (!res.ok || !res.workspace) {
        toast.error(res.error || '保存失败')
        return ''
      }
      await get().refreshSessions()
      void get().loadWorkspaces()
      toast.success('已保存「' + res.workspace.name + '」')
      return res.workspace.id
    } catch (error) {
      toast.error('保存失败：' + (error instanceof Error ? error.message : String(error)))
      return ''
    }
  },

  removeWorkspace: async (id) => {
    try {
      const res = await api.removeWorkspace(id)
      if (!res.ok) {
        toast.error(res.error || '删除失败')
        return false
      }
      await get().refreshSessions()
      void get().loadWorkspaces()
      toast.success('已删除工作空间（文件夹本身没动）')
      return true
    } catch (error) {
      toast.error('删除失败：' + (error instanceof Error ? error.message : String(error)))
      return false
    }
  },

  openWorkspace: async (path) => {
    try {
      const res = await api.openWorkspace(path)
      if (!res.ok) {
        toast.error(res.error || '打开失败')
        return
      }
      toast.success('已在新窗口打开 ' + path)
    } catch (error) {
      toast.error('打开失败：' + (error instanceof Error ? error.message : String(error)))
    }
  },

  pickWorkspace: async () => {
    try {
      const res = await api.pickWorkspace()
      return res.path || ''
    } catch (error) {
      toast.error('选择目录失败：' + (error instanceof Error ? error.message : String(error)))
      return ''
    }
  },

  createWorkspace: async (name, parent) => {
    try {
      const res = await api.createWorkspace(name, parent)
      if (!res.ok) {
        toast.error(res.error || '新建失败')
        return ''
      }
      await get().useWorkspace(res.path)
      void get().loadWorkspaces()
      if (res.existed) toast.info('工作空间已存在，已直接切换过去')
      return res.path
    } catch (error) {
      toast.error('新建失败：' + (error instanceof Error ? error.message : String(error)))
      return ''
    }
  },

  addAttachment: (attachment) => {
    if (get().attachments.length >= 4) {
      toast.warning('最多同时带 4 张图片')
      return
    }
    set({ attachments: [...get().attachments, attachment] })
  },

  removeAttachment: (index) => {
    set({ attachments: get().attachments.filter((_, i) => i !== index) })
  },

  addConnector: (name) => {
    if (!name) return
    if (get().connectorRefs.includes(name)) return
    set({ connectorRefs: [...get().connectorRefs, name] })
  },

  removeConnector: (name) => {
    set({ connectorRefs: get().connectorRefs.filter((x) => x !== name) })
  },

  clearComposerExtras: () => set({ attachments: [], connectorRefs: [] }),

  getDraft: () => {
    const key = get().activeId || 'new:' + get().cwd
    return drafts[key] || ''
  },

  setDraft: (text) => {
    const key = get().activeId || 'new:' + get().cwd
    if (text.trim()) drafts[key] = text
    else delete drafts[key]
    saveDrafts()
  },

  clearDraft: () => {
    const key = get().activeId || 'new:' + get().cwd
    delete drafts[key]
    saveDrafts()
  },

  pushHistory: (text) => {
    if (!text) return
    const history = get().history
    if (history[history.length - 1] === text) return
    set({ history: [...history.slice(-49), text] })
  },
}))
