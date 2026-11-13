import type {
  AcpEvent,
  ChatMessage,
  ChatPart,
  ChatStatus,
  FileKind,
  FileRef,
  PermissionData,
  PlanEntry,
  ToolArtifact,
  UsagePartData,
} from './types'

let counter = 0
function uid(prefix: string) {
  counter += 1
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`
}

function withAssistant(messages: ChatMessage[], fn: (parts: ChatPart[]) => ChatPart[]): ChatMessage[] {
  const idx = messages.length - 1
  const last = messages[idx]
  if (last && last.role === 'assistant' && last.status.type === 'running') {
    return [...messages.slice(0, idx), { ...last, parts: fn(last.parts) }]
  }
  const created: ChatMessage = {
    id: uid('a_'),
    role: 'assistant',
    parts: [],
    status: { type: 'running' },
    createdAt: Date.now(),
  }
  return [...messages, { ...created, parts: fn([]) }]
}

function appendText(messages: ChatMessage[], text: string) {
  if (!text) return messages
  return withAssistant(messages, (parts) => {
    const last = parts[parts.length - 1]
    if (last && last.type === 'text' && last.status === 'running') {
      const next = [...parts]
      next[next.length - 1] = { ...last, text: last.text + text }
      return next
    }
    return [...parts, { type: 'text', id: uid('t_'), text, status: 'running' }]
  })
}

function appendReasoning(messages: ChatMessage[], text: string) {
  if (!text) return messages
  return withAssistant(messages, (parts) => {
    const last = parts[parts.length - 1]
    if (last && last.type === 'reasoning' && last.status === 'running') {
      const next = [...parts]
      next[next.length - 1] = { ...last, text: last.text + text }
      return next
    }
    return [...parts, { type: 'reasoning', id: uid('r_'), text, status: 'running' }]
  })
}

function fileKind(name: string): FileKind | null {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'm4a', 'ogg', 'oga'].includes(ext)) return 'audio'
  if (ext === 'docx') return 'docx'
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'xlsx'
  if (ext === 'pptx') return 'pptx'
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'ppt'].includes(ext)) return 'other'
  return null
}

function fileRefFromPath(path: string): FileRef | null {
  if (!path || typeof path !== 'string') return null
  let clean = path.trim()
  if (clean.startsWith('file://')) {
    clean = clean.slice(7)
    if (clean.startsWith('/')) clean = clean.slice(1)
    try {
      clean = decodeURIComponent(clean)
    } catch {
      // keep raw
    }
  }
  if (/^https?:/i.test(clean)) return null
  const name = clean.split(/[\\/]/).pop() || clean
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const kind = fileKind(name)
  if (!kind) return null
  return { path: clean, name, ext, kind }
}

function asObject(value: unknown): any {
  if (value && typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return null
}

function findFile(data: Record<string, any>, content: unknown): FileRef | null {
  const candidates: unknown[] = []
  const input = asObject(data.rawInput)
  if (input) {
    candidates.push(input.path, input.file_path, input.filePath)
  }
  const output = asObject(data.rawOutput)
  if (output) {
    candidates.push(output.path, output.file_path, output.filePath)
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'diff' && typeof block.path === 'string') candidates.push(block.path)
      if (block.type === 'link' && typeof block.uri === 'string') candidates.push(block.uri)
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const file = fileRefFromPath(candidate)
    if (file) return file
  }
  return null
}

function toolArtifact(data: Record<string, any>): ToolArtifact {
  const artifact: ToolArtifact = {}
  if (data.title !== undefined) artifact.title = data.title
  if (data.kind !== undefined) artifact.kind = data.kind
  if (data.status !== undefined) artifact.status = data.status
  if (data.content !== undefined) artifact.content = data.content
  if (data.rawInput !== undefined) artifact.rawInput = data.rawInput
  if (data.rawOutput !== undefined) artifact.rawOutput = data.rawOutput
  const file = findFile(data, data.content)
  if (file) artifact.file = file
  return artifact
}

function upsertTool(messages: ChatMessage[], data: Record<string, any>, update: boolean) {
  const toolCallId = String(data.id || data.toolCallId || '')
  if (!toolCallId) return messages
  return withAssistant(messages, (parts) => {
    const idx = parts.findIndex((p) => p.type === 'tool-call' && p.toolCallId === toolCallId)
    if (idx < 0) {
      const artifact = toolArtifact(data)
      return [
        ...parts,
        {
          type: 'tool-call',
          toolCallId,
          toolName: String(data.kind || 'tool'),
          args: (data.rawInput as Record<string, unknown>) || {},
          argsText: JSON.stringify(data.rawInput || {}, null, 2),
          result: data.status === 'completed' || data.status === 'failed' ? data.content : undefined,
          isError: data.status === 'failed',
          artifact,
        },
      ]
    }
    const next = [...parts]
    const prev = parts[idx]
    if (prev.type !== 'tool-call') return parts
    const artifact: ToolArtifact = { ...(prev.artifact || {}), ...toolArtifact(data) }
    if (!update) {
      // tool_call 事件带完整字段，直接覆盖；tool_call_update 只补差异
      next[idx] = {
        ...prev,
        args: (data.rawInput as Record<string, unknown>) || prev.args,
        argsText: data.rawInput ? JSON.stringify(data.rawInput, null, 2) : prev.argsText,
        artifact,
      }
    } else {
      next[idx] = {
        ...prev,
        artifact,
        result: data.content !== undefined ? data.content : prev.result,
        isError: data.status === 'failed' ? true : data.status === 'completed' ? false : prev.isError,
      }
    }
    return next
  })
}

function upsertData(
  messages: ChatMessage[],
  id: string,
  type: 'data-plan' | 'data-permission' | 'data-usage' | 'data-error',
  data: unknown,
) {
  return withAssistant(messages, (parts) => {
    const idx = parts.findIndex((p) => 'id' in p && p.id === id && p.type === type)
    if (idx < 0) return [...parts, { type, id, data } as ChatPart]
    const next = [...parts]
    next[idx] = { ...(parts[idx] as any), data } as ChatPart
    return next
  })
}

function upsertPlan(messages: ChatMessage[], entries: PlanEntry[]) {
  return withAssistant(messages, (parts) => {
    let idx = -1
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (parts[i].type === 'data-plan') {
        idx = i
        break
      }
    }
    if (idx < 0) return [...parts, { type: 'data-plan', id: uid('plan_'), data: { entries } }]
    const existing = parts[idx]
    if (existing.type !== 'data-plan') return parts
    const next = [...parts]
    next[idx] = { type: 'data-plan', id: existing.id, data: { entries } }
    return next
  })
}

function addPermission(messages: ChatMessage[], data: PermissionData) {
  return withAssistant(messages, (parts) => [
    ...parts,
    { type: 'data-permission', id: `perm_${data.requestId}`, data },
  ])
}

function resolvePermission(messages: ChatMessage[], requestId: string, optionId: string) {
  return messages.map((m) => {
    let changed = false
    const parts = m.parts.map((p) => {
      if (p.type === 'data-permission' && p.data.requestId === requestId) {
        changed = true
        return { ...p, data: { ...p.data, resolvedOptionId: optionId } }
      }
      return p
    })
    return changed ? { ...m, parts } : m
  })
}

function addUsage(messages: ChatMessage[], data: UsagePartData) {
  return withAssistant(messages, (parts) => {
    let idx = -1
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (parts[i].type === 'data-usage') {
        idx = i
        break
      }
    }
    if (idx < 0) return [...parts, { type: 'data-usage', id: uid('u_'), data }]
    const next = [...parts]
    next[idx] = { ...(parts[idx] as any), data }
    return next
  })
}

function setStatus(messages: ChatMessage[], status: ChatStatus) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') {
      const next = [...messages]
      next[i] = {
        ...messages[i],
        status,
        parts: messages[i].parts.map((p) =>
          (p.type === 'text' || p.type === 'reasoning') && p.status === 'running'
            ? { ...p, status: 'complete' as const }
            : p,
        ),
      }
      return next
    }
  }
  return messages
}

export function addUserMessage(messages: ChatMessage[], data: Record<string, any>): ChatMessage[] {
  const parts: ChatPart[] = []
  const text = String(data.text || '')
  if (text) parts.push({ type: 'text', id: uid('t_'), text, status: 'complete' })
  const images = Array.isArray(data.images) ? data.images : []
  for (const img of images) {
    if (img && typeof img.url === 'string') {
      parts.push({ type: 'image', id: uid('img_'), image: img.url, filename: img.name })
    }
  }
  const connectors = Array.isArray(data.connectors)
    ? data.connectors.filter((x: unknown): x is string => typeof x === 'string')
    : []
  if (connectors.length) {
    parts.push({ type: 'data-user-meta', id: uid('meta_'), data: { connectors } })
  }
  if (!parts.length) return messages
  return [
    ...messages,
    {
      id: uid('m_'),
      role: 'user',
      parts,
      status: { type: 'complete', reason: 'stop' },
      createdAt: Date.now(),
    },
  ]
}

export function applyEvent(messages: ChatMessage[], ev: AcpEvent): ChatMessage[] {
  const data = ev.data || {}
  switch (ev.type) {
    case 'user':
      return addUserMessage(messages, data)
    case 'text':
      return appendText(messages, String(data.text || ''))
    case 'thought':
      return appendReasoning(messages, String(data.text || ''))
    case 'tool':
      return upsertTool(messages, data, false)
    case 'tool_update':
      return upsertTool(messages, data, true)
    case 'plan':
      return upsertPlan(messages, (data.entries as PlanEntry[]) || [])
    case 'permission':
      return addPermission(messages, {
        requestId: String(data.requestId || ''),
        title: String(data.title || '需要授权'),
        kind: data.kind,
        options: (data.options as PermissionData['options']) || [],
      })
    case 'permission_resolved':
      return resolvePermission(messages, String(data.requestId || ''), String(data.optionId || ''))
    case 'usage':
      return addUsage(messages, {
        used: Number(data.used || 0),
        size: Number(data.size || 0),
        nominal: Number(data.originalCredit ?? data.credit ?? 0),
        actual: Number(data.credit ?? 0),
        quota: data.quota,
        tokens: data.tokens,
      })
    case 'error':
      return upsertData(messages, uid('err_'), 'data-error', { message: String(data.message || '出错了') })
    case 'auth_required':
      return upsertData(messages, uid('err_'), 'data-error', {
        message: String(data.message || '需要登录'),
        kind: 'auth',
      })
    case 'done': {
      const reason = String(data.stopReason || 'end_turn')
      if (reason === 'cancelled') return setStatus(messages, { type: 'incomplete', reason: 'cancelled' })
      if (reason === 'error' || reason === 'refusal') return setStatus(messages, { type: 'incomplete', reason: 'error' })
      return setStatus(messages, { type: 'complete', reason: 'stop' })
    }
    default:
      return messages
  }
}

export function eventsToMessages(events: { type: string; data: Record<string, unknown> }[]): ChatMessage[] {
  let messages: ChatMessage[] = []
  events.forEach((ev, index) => {
    messages = applyEvent(messages, {
      seq: index + 1,
      type: ev.type,
      sessionId: String(ev.data?.sessionId || ''),
      data: ev.data || {},
    })
  })
  // 历史记录里不会有正在跑的 turn，统一收尾
  messages = messages.map((m) =>
    m.role === 'assistant' && m.status.type === 'running'
      ? { ...m, status: { type: 'complete', reason: 'stop' } as ChatStatus }
      : m,
  )
  return messages
}
