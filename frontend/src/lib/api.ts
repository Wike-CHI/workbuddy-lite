import type {
  AcpEvent,
  Bootstrap,
  Catalog,
  ModelInfo,
  Quota,
  SessionDetail,
  UsageSummary,
  Workspace,
  WorkspaceRecord,
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
    images: { mime: string; data: string; name: string }[]
    connectors: string[]
  }) => post<{ sessionId: string; images: { url: string; mime: string; name: string }[] }>('/api/chat', body),
  cancel: (sessionId: string) => post<{ ok: boolean }>('/api/cancel', { sessionId }),
  permission: (requestId: string, optionId: string) =>
    post<{ ok: boolean }>('/api/permission', { requestId, optionId }),
  models: () =>
    request<{ models: ModelInfo[]; currentId: string; selected?: string; quota?: Quota; error?: string }>(
      '/api/models',
    ),
  setModel: (model: string, sessionId: string) =>
    post<{ ok: boolean; applied: boolean; model: string; error?: string }>('/api/model', { model, sessionId }),
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
  openWorkspace: (path: string) =>
    post<{ ok: boolean; path: string; error?: string }>('/api/workspaces/open', { path }),
  pickWorkspace: () => post<{ path: string }>('/api/workspaces/pick', {}),
  createWorkspace: (name: string, parent?: string) =>
    post<{ ok: boolean; path: string; workspace: string; existed: boolean; error?: string }>(
      '/api/workspaces/create',
      { name, parent: parent || '' },
    ),
  catalog: () => request<Catalog>('/api/catalog'),
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
  log: (message: string) => {
    void fetch('/api/log', { method: 'POST', body: message, keepalive: true }).catch(() => undefined)
  },
}
