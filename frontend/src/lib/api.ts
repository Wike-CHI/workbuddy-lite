import type {
  AcpEvent,
  Bootstrap,
  Catalog,
  ConfigOption,
  MarketJob,
  MarketOverview,
  ModelInfo,
  Quota,
  SessionDetail,
  UsageSummary,
  Workspace,
  WorkspaceRecord,
  TreeEntry,
  GitOverview,
  GitDiffResult,
} from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const text = await res.text()
  if (!res.ok) {
    let message = text || '请求失败'
    try {
      const parsed = JSON.parse(text)
      message = parsed.error || message
    } catch {
      // keep raw text
    }
    throw new Error(message)
  }
  return text ? (JSON.parse(text) as T) : ({} as T)
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

export const api = {
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  sessions: () => request<Bootstrap>('/api/sessions'),
  session: (id: string) => request<SessionDetail>(`/api/sessions/${id}`),
  renameSession: (id: string, title: string) =>
    post<{ ok: boolean }>(`/api/sessions/${id}/rename`, { title }),
  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  chat: (body: {
    sessionId: string
    text: string
    mode: string
    model: string
    config?: Record<string, string | boolean>
    images: { mime: string; data: string; name: string }[]
    connectors: string[]
  }) => post<{ sessionId: string; images: { url: string; mime: string; name: string }[] }>('/api/chat', body),
  cancel: (sessionId: string) => post<{ ok: boolean }>('/api/cancel', { sessionId }),
  permission: (requestId: string, optionId: string) =>
    post<{ ok: boolean }>('/api/permission', { requestId, optionId }),
  models: () =>
    request<{
      models: ModelInfo[]
      currentId: string
      selected?: string
      config?: { options: ConfigOption[] }
      quota?: Quota
      error?: string
    }>('/api/models'),
  setModel: (model: string, sessionId: string) =>
    post<{ ok: boolean; applied: boolean; model: string; error?: string }>('/api/model', { model, sessionId }),
  setConfig: (configId: string, value: string | boolean, sessionId: string, type?: string) =>
    post<{ ok: boolean; applied: boolean; configId: string; value: string | boolean; options?: ConfigOption[]; error?: string }>(
      '/api/config',
      { configId, value, sessionId, type },
    ),
  usage: () => request<UsageSummary>('/api/usage'),
  workspaces: () =>
    request<{
      cwd: string
      workspace: string
      workspaceId?: string
      workspaceName?: string
      workspaceFolders?: string[]
      agentReady: boolean
      demo: boolean
      workspaces: Workspace[]
    }>('/api/workspaces'),
  useWorkspace: (payload: { path?: string; id?: string }) =>
    post<{ ok: boolean; cwd: string; workspace: string; id?: string; folders?: string[]; error?: string }>(
      '/api/workspaces/use',
      payload,
    ),
  saveWorkspace: (payload: { id?: string; name: string; folders: string[] }) =>
    post<{ ok: boolean; workspace?: WorkspaceRecord; error?: string }>('/api/workspaces/save', payload),
  removeWorkspace: (id: string) =>
    post<{ ok: boolean; error?: string }>('/api/workspaces/remove', { id }),
  tree: (path?: string) =>
    request<{ entries: TreeEntry[] }>('/api/tree' + (path ? `?path=${encodeURIComponent(path)}` : '')),
  git: () => request<GitOverview>('/api/git'),
  gitDiff: (path: string, staged = false) =>
    request<GitDiffResult>(`/api/git/diff?path=${encodeURIComponent(path)}${staged ? '&staged=1' : ''}`),
  gitAction: (payload: {
    action: 'stage' | 'unstage' | 'commit'
    folder: string
    paths?: string[]
    message?: string
  }) => post<{ ok: boolean; output?: string; error?: string }>('/api/git/action', payload),
  importChromeCookies: () =>
    post<{ ok: boolean; total?: number; imported?: number; skipped?: number; error?: string }>(
      '/api/browser/import',
      {},
    ),
  openWorkspace: (path: string) =>
    post<{ ok: boolean; path: string; error?: string }>('/api/workspaces/open', { path }),
  pickWorkspace: () => post<{ path: string }>('/api/workspaces/pick', {}),
  createWorkspace: (name: string, parent?: string) =>
    post<{ ok: boolean; path: string; workspace: string; existed: boolean; error?: string }>(
      '/api/workspaces/create',
      { name, parent: parent || '' },
    ),
  catalog: () => request<Catalog>('/api/catalog'),
  marketOverview: () => request<MarketOverview>('/api/market/overview'),
  parseMarket: (url: string) => post<{ ok: boolean; job: MarketJob }>('/api/market/parse', { url }),
  installPlugin: (plugin: string, marketplace: string) =>
    post<{ ok: boolean; job: MarketJob }>('/api/market/install', { plugin, marketplace }),
  uninstallPlugin: (plugin: string, marketplace: string) =>
    post<{ ok: boolean; job: MarketJob }>('/api/market/uninstall', { plugin, marketplace }),
  marketJob: (id: string) => request<{ ok: boolean; job: MarketJob }>(`/api/market/job?id=${encodeURIComponent(id)}`),
  aiOrganize: () =>
    post<{ ok: boolean; projects: { cwd: string; name: string }[]; sessions: { id: string; title: string }[]; error?: string }>(
      '/api/projects/ai-organize',
      {},
    ),
  applyProjects: (projects: { path: string; name: string }[], sessions: { id: string; title: string }[]) =>
    post<{ ok: boolean; projects: number; sessions: number; error?: string }>('/api/projects/apply', {
      projects,
      sessions,
    }),
  events: (from: number, wait = 10000) =>
    request<{ events: AcpEvent[]; lastSeq: number }>(`/api/events?from=${from}&wait=${wait}`),
  teamState: () =>
    request<{
      enabled: boolean
      canCreate?: boolean
      orchestrationEnabled?: boolean
      channelMaxMembers?: number
      defaultAgentId?: string
      agents: unknown[]
      channels: unknown[]
      presence?: { agentId: string; availability: string }[]
      reason?: string
      retry?: boolean
    }>('/api/team/state'),
  teamMessages: (channelId: string, before = '') =>
    request<{ messages: unknown[]; hasMore: boolean; before: string }>(
      `/api/team/messages?channelId=${encodeURIComponent(channelId)}${
        before ? `&before=${encodeURIComponent(before)}` : ''
      }`,
    ),
  teamSend: (payload: { channelId: string; text: string; mentionAgentIds: string[] }) =>
    post<{ ok: boolean; message?: unknown; warning?: string; error?: string }>('/api/team/send', payload),
  teamCreate: (payload: { name: string; memberAgentIds: string[]; leadAgentId?: string }) =>
    post<{ ok: boolean; channel?: unknown; warning?: string; error?: string }>(
      '/api/team/channel',
      payload,
    ),
  teamEvents: (channelId: string, from: number, wait = 15000) =>
    request<{
      events: { seq: number; channelId: string; message: unknown }[]
      lastSeq: number
      error?: string
    }>(
      `/api/team/events?channelId=${encodeURIComponent(channelId)}&from=${from}&wait=${wait}`,
    ),
  teamMember: (payload: { channelId: string; agentId: string; muted: boolean }) =>
    post<{ ok: boolean; channel?: unknown; error?: string }>('/api/team/member', payload),
  teamRestart: (agentId: string) =>
    post<{ ok: boolean; error?: string }>('/api/team/member/restart', { agentId }),
  log: (message: string) => {
    void fetch('/api/log', { method: 'POST', body: message, keepalive: true }).catch(() => undefined)
  },
}
