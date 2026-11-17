// UI 状态镜像：WebView2 的用户数据目录按 PID 隔离，localStorage 在重启后不会保留，
// 所以会话/频道/工作台/模型这些「重启后要回到原位」的状态另外存一份到后端。
export interface UiStateSnapshot {
  activeSessionId?: string
  activeChannelId?: string | null
  chat?: {
    mode?: string
    model?: string
    thought?: string
    config?: Record<string, string | boolean>
  }
  workbench?: {
    open: boolean
    width: number
    tab: string
  }
}

let pending: UiStateSnapshot = {}
let timer: ReturnType<typeof setTimeout> | null = null

// 合并同一轮里的多次改动，避免拖一次右栏宽度就发一串请求
export function markUiState(patch: UiStateSnapshot) {
  pending = { ...pending, ...patch }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flushUiState()
  }, 350)
}

// 重启前要立刻落盘，不能等 debounce
export async function flushUiState() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const body = pending
  pending = {}
  if (!Object.keys(body).length) return
  try {
    await fetch('/api/app/ui', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    })
  } catch {
    // 页面即将退出时允许失败；下一次改动会再写一遍
  }
}

export async function loadUiState(): Promise<UiStateSnapshot> {
  try {
    const res = await fetch('/api/app/ui', { cache: 'no-store' })
    if (!res.ok) return {}
    const data = (await res.json()) as UiStateSnapshot
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}
