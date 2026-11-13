import { create } from 'zustand'

import type { SavedWidget, VisualTemplate, VisualTheme, WidgetKind, WidgetSpec } from '@/lib/types'

const TEMPLATE_KEY = 'wbl.iui.templates.v1'
const SAVED_KEY = 'wbl.iui.saved.v1'

const SYSTEM_FONT =
  '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'

export const DEFAULT_TEMPLATES: VisualTemplate[] = [
  {
    id: 'blue',
    name: '清爽蓝',
    builtin: true,
    theme: {
      primary: '#2f6feb',
      accent: '#6b4ff5',
      background: '#ffffff',
      foreground: '#16181d',
      muted: '#f1f3f6',
      fontFamily: SYSTEM_FONT,
      radius: 16,
      palette: ['#2f6feb', '#6b4ff5', '#1a9f60', '#f59e0b', '#ef4444', '#06b6d4'],
    },
  },
  {
    id: 'warm',
    name: '暖阳橙',
    builtin: true,
    theme: {
      primary: '#d97706',
      accent: '#ea580c',
      background: '#fffbf5',
      foreground: '#2b2117',
      muted: '#fdf2e3',
      fontFamily: SYSTEM_FONT,
      radius: 18,
      palette: ['#d97706', '#ea580c', '#b45309', '#f59e0b', '#dc2626', '#65a30d'],
    },
  },
  {
    id: 'mono',
    name: '极简黑白',
    builtin: true,
    theme: {
      primary: '#111827',
      accent: '#4b5563',
      background: '#ffffff',
      foreground: '#111827',
      muted: '#f4f4f5',
      fontFamily: SYSTEM_FONT,
      radius: 10,
      palette: ['#111827', '#4b5563', '#9ca3af', '#d1d5db', '#6b7280', '#374151'],
    },
  },
]

function restore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

const initialTemplates = restore<VisualTemplate[]>(TEMPLATE_KEY, DEFAULT_TEMPLATES)
const initialSaved = restore<SavedWidget[]>(SAVED_KEY, [])
const initialDefault =
  initialTemplates.find((t) => t.id === 'blue')?.id || initialTemplates[0]?.id || 'blue'

export function resolveTheme(spec: WidgetSpec | undefined, templates: VisualTemplate[], defaultId: string): VisualTheme {
  const base =
    templates.find((t) => t.id === (spec?.template || defaultId))?.theme ||
    templates[0]?.theme ||
    DEFAULT_TEMPLATES[0].theme
  if (!spec?.theme) return base
  return { ...base, ...spec.theme, palette: spec.theme.palette?.length ? spec.theme.palette : base.palette }
}

function widgetTitle(spec: WidgetSpec) {
  if (spec.title) return spec.title
  const labels: Record<WidgetKind, string> = {
    chart: '图表',
    map: '地图',
    form: '表单',
    article: '文章',
  }
  return labels[spec.type] || '交互回答'
}

interface IntelligentUiState {
  templates: VisualTemplate[]
  saved: SavedWidget[]
  defaultTemplateId: string
  libraryOpen: boolean
  libraryTab: 'saved' | 'templates'
  load: () => Promise<void>
  setLibraryOpen: (open: boolean, tab?: 'saved' | 'templates') => void
  upsertTemplate: (template: VisualTemplate) => void
  deleteTemplate: (id: string) => void
  setDefaultTemplate: (id: string) => void
  saveWidget: (spec: WidgetSpec, existingId?: string) => SavedWidget
  deleteWidget: (id: string) => void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function scheduleServerSave(templates: VisualTemplate[], saved: SavedWidget[], defaultTemplateId: string) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void fetch('/api/iui', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templates, saved, defaultTemplateId }),
    }).catch(() => undefined)
  }, 300)
}

export const useIntelligentUiStore = create<IntelligentUiState>()((set, get) => ({
  templates: initialTemplates,
  saved: initialSaved,
  defaultTemplateId: initialDefault,
  libraryOpen: false,
  libraryTab: 'saved',

  load: async () => {
    try {
      const res = await fetch('/api/iui').then((r) => r.json())
      const templates: VisualTemplate[] =
        Array.isArray(res.templates) && res.templates.length ? res.templates : get().templates
      const saved: SavedWidget[] = Array.isArray(res.saved) ? res.saved : get().saved
      const defaultTemplateId = templates.some((t) => t.id === res.defaultTemplateId)
        ? res.defaultTemplateId
        : templates.some((t) => t.id === get().defaultTemplateId)
          ? get().defaultTemplateId
          : templates[0]?.id || 'blue'
      set({ templates, saved, defaultTemplateId })
      persist(TEMPLATE_KEY, templates)
      persist(SAVED_KEY, saved)
      if (!Array.isArray(res.templates) || !res.templates.length) {
        scheduleServerSave(templates, saved, defaultTemplateId)
      }
    } catch {
      // 后端不可用时继续用 localStorage
    }
  },

  setLibraryOpen: (open, tab) =>
    set((state) => ({
      libraryOpen: open,
      libraryTab: tab || state.libraryTab,
    })),

  upsertTemplate: (template) => {
    set((state) => {
      const templates = state.templates.some((t) => t.id === template.id)
        ? state.templates.map((t) => (t.id === template.id ? template : t))
        : [...state.templates, template]
      persist(TEMPLATE_KEY, templates)
      return { templates }
    })
    scheduleServerSave(get().templates, get().saved, get().defaultTemplateId)
  },

  deleteTemplate: (id) => {
    set((state) => {
      if (state.templates.length <= 1) return state
      const templates = state.templates.filter((t) => t.id !== id)
      const defaultTemplateId = state.defaultTemplateId === id ? templates[0].id : state.defaultTemplateId
      persist(TEMPLATE_KEY, templates)
      return { templates, defaultTemplateId }
    })
    scheduleServerSave(get().templates, get().saved, get().defaultTemplateId)
  },

  setDefaultTemplate: (id) => {
    if (!get().templates.some((t) => t.id === id)) return
    set({ defaultTemplateId: id })
    persist(TEMPLATE_KEY, get().templates)
    try {
      localStorage.setItem('wbl.iui.defaultTemplate', id)
    } catch {
      // ignore
    }
    scheduleServerSave(get().templates, get().saved, id)
  },

  saveWidget: (spec, existingId) => {
    const now = Date.now()
    const existing = existingId ? get().saved.find((w) => w.id === existingId) : undefined
    const widget: SavedWidget = {
      id: existing?.id || `w_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: widgetTitle(spec),
      spec,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    const saved = existing
      ? get().saved.map((w) => (w.id === widget.id ? widget : w))
      : [widget, ...get().saved]
    set({ saved })
    persist(SAVED_KEY, saved)
    scheduleServerSave(get().templates, saved, get().defaultTemplateId)
    return widget
  },

  deleteWidget: (id) => {
    const saved = get().saved.filter((w) => w.id !== id)
    set({ saved })
    persist(SAVED_KEY, saved)
    scheduleServerSave(get().templates, saved, get().defaultTemplateId)
  },
}))

// 默认模板 id 单独存一下，避免模板列表变化时丢掉用户选择
try {
  const storedDefault = localStorage.getItem('wbl.iui.defaultTemplate')
  if (storedDefault && initialTemplates.some((t) => t.id === storedDefault)) {
    useIntelligentUiStore.setState({ defaultTemplateId: storedDefault })
  }
} catch {
  // ignore
}
