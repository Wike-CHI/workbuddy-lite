import { create } from 'zustand'

export type Theme = 'light' | 'dark'

const KEY = 'wbl.theme'

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

function initial(): Theme {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // ignore
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggle: () => void
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: initial(),
  setTheme: (theme) => {
    apply(theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // ignore
    }
    set({ theme })
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}))

export function initTheme() {
  const theme = useThemeStore.getState().theme
  apply(theme)
  // 跟随系统只在用户没手动选过时生效
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (event) => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(KEY)
    } catch {
      // ignore
    }
    if (stored === 'light' || stored === 'dark') return
    useThemeStore.getState().setTheme(event.matches ? 'dark' : 'light')
  })
}
