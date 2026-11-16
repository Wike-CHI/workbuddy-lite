import { create } from 'zustand'

import { api } from '@/lib/api'
import type { GitDiffResult, GitOverview, TreeEntry } from '@/lib/types'

export type WorkbenchTab = 'files' | 'diff' | 'plan' | 'todos' | 'git' | 'tasks' | 'browser'

const STORAGE_KEY = 'wbl.workbench'

interface Persisted {
  open: boolean
  width: number
  tab: WorkbenchTab
}

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { open: false, width: 380, tab: 'files' }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      open: !!parsed.open,
      width: Math.min(720, Math.max(300, Number(parsed.width) || 380)),
      tab: (parsed.tab as WorkbenchTab) || 'files',
    }
  } catch {
    return { open: false, width: 380, tab: 'files' }
  }
}

function persist(state: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

const CODE_LIMIT = 300 * 1024

interface WorkbenchState {
  open: boolean
  width: number
  tab: WorkbenchTab
  tree: Record<string, TreeEntry[]>
  expanded: string[]
  file: { path: string; text: string; truncated: boolean; error?: string } | null
  fileLoading: boolean
  git: GitOverview | null
  gitLoading: boolean
  diff: GitDiffResult | null
  diffLoading: boolean
  browserUrl: string
  browserInfo: { url?: string; title?: string; loading?: boolean; canGoBack?: boolean; canGoForward?: boolean } | null

  toggle: (open?: boolean) => void
  setTab: (tab: WorkbenchTab) => void
  setWidth: (width: number) => void
  loadTree: (path?: string) => Promise<void>
  toggleDir: (path: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  closeFile: () => void
  refreshGit: () => Promise<void>
  stage: (folder: string, paths: string[]) => Promise<void>
  unstage: (folder: string, paths: string[]) => Promise<void>
  commit: (folder: string, message: string) => Promise<boolean>
  openDiff: (path: string, staged: boolean) => Promise<void>
  closeDiff: () => void
  setBrowserUrl: (url: string) => void
  setBrowserInfo: (info: WorkbenchState['browserInfo']) => void
}

const initial = readPersisted()

export const useWorkbenchStore = create<WorkbenchState>()((set, get) => ({
  open: initial.open,
  width: initial.width,
  tab: initial.tab,
  tree: {},
  expanded: [],
  file: null,
  fileLoading: false,
  git: null,
  gitLoading: false,
  diff: null,
  diffLoading: false,
  browserUrl: 'http://localhost:3000',
  browserInfo: null,

  toggle: (open) => {
    const next = open === undefined ? !get().open : open
    set({ open: next })
    persist({ open: next, width: get().width, tab: get().tab })
    if (next && !get().git) void get().refreshGit()
    if (!next) postBrowser({ action: 'hide' })
  },

  setTab: (tab) => {
    set({ tab })
    persist({ open: get().open, width: get().width, tab })
    if ((tab === 'git' || tab === 'diff') && !get().git) void get().refreshGit()
  },

  setWidth: (width) => {
    const clamped = Math.min(720, Math.max(300, width))
    set({ width: clamped })
    persist({ open: get().open, width: clamped, tab: get().tab })
  },

  loadTree: async (path) => {
    const key = path || ''
    try {
      const res = await api.tree(path)
      set({ tree: { ...get().tree, [key]: res.entries || [] } })
      // 展开父目录时顺手把根也读出来
      if (path && !get().tree['']) {
        const root = await api.tree()
        set({ tree: { ...get().tree, '': root.entries || [] } })
      }
    } catch {
      set({ tree: { ...get().tree, [key]: [] } })
    }
  },

  toggleDir: async (path) => {
    const expanded = get().expanded
    if (expanded.includes(path)) {
      set({ expanded: expanded.filter((p) => p !== path) })
      return
    }
    set({ expanded: [...expanded, path] })
    if (!get().tree[path]) await get().loadTree(path)
  },

  openFile: async (path) => {
    set({ fileLoading: true, file: { path, text: '', truncated: false } })
    try {
      const res = await fetch('/api/file?path=' + encodeURIComponent(path))
      if (!res.ok) {
        let message = '读取失败'
        try {
          message = (await res.json()).error || message
        } catch {
          // ignore
        }
        set({ file: { path, text: '', truncated: false, error: message }, fileLoading: false })
        return
      }
      const text = await res.text()
      set({
        file: { path, text: text.slice(0, CODE_LIMIT), truncated: text.length > CODE_LIMIT },
        fileLoading: false,
      })
    } catch (error) {
      set({
        file: { path, text: '', truncated: false, error: error instanceof Error ? error.message : String(error) },
        fileLoading: false,
      })
    }
  },

  closeFile: () => set({ file: null, diff: null }),

  refreshGit: async () => {
    set({ gitLoading: true })
    try {
      const git = await api.git()
      set({ git, gitLoading: false })
    } catch {
      set({ gitLoading: false })
    }
  },

  stage: async (folder, paths) => {
    try {
      const res = await api.gitAction({ action: 'stage', folder, paths })
      if (!res.ok) throw new Error(res.error || '暂存失败')
      await get().refreshGit()
    } catch {
      // 错误由面板自己提示
      await get().refreshGit()
    }
  },

  unstage: async (folder, paths) => {
    try {
      const res = await api.gitAction({ action: 'unstage', folder, paths })
      if (!res.ok) throw new Error(res.error || '取消暂存失败')
      await get().refreshGit()
    } catch {
      await get().refreshGit()
    }
  },

  commit: async (folder, message) => {
    const res = await api.gitAction({ action: 'commit', folder, message })
    await get().refreshGit()
    return res.ok
  },

  openDiff: async (path, staged) => {
    set({ diffLoading: true })
    try {
      const diff = await api.gitDiff(path, staged)
      set({ diff, diffLoading: false })
    } catch (error) {
      set({
        diff: {
          path,
          folder: '',
          staged,
          diff: '',
          error: error instanceof Error ? error.message : String(error),
        },
        diffLoading: false,
      })
    }
  },

  closeDiff: () => set({ diff: null }),

  setBrowserUrl: (url) => set({ browserUrl: url }),

  setBrowserInfo: (info) => set({ browserInfo: info }),
}))

export function postBrowser(payload: Record<string, unknown>) {
  const host = (window as unknown as { chrome?: { webview?: { postMessage: (v: unknown) => void } } }).chrome
  host?.webview?.postMessage({ type: 'browser', ...payload })
}
