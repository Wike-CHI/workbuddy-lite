import { create } from 'zustand'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import { flushUiState } from '@/lib/uiState'

interface AppUpdateState {
  ready: boolean
  confirmOpen: boolean
  restarting: boolean
  check: () => Promise<void>
  openConfirm: () => void
  closeConfirm: () => void
  apply: () => Promise<void>
  preview: (on: boolean) => void
}

let fallbackTimer: ReturnType<typeof setTimeout> | null = null

export const useAppUpdateStore = create<AppUpdateState>()((set, get) => ({
  ready: false,
  confirmOpen: false,
  restarting: false,

  check: async () => {
    try {
      const res = await api.appUpdate()
      set({ ready: !!res.updateReady, restarting: !!res.restarting })
    } catch {
      set({ ready: false })
    }
  },

  openConfirm: () => set({ confirmOpen: true }),
  closeConfirm: () => set({ confirmOpen: false }),
  // 截图用：只显示遮罩，不发重启请求
  preview: (on) => set({ restarting: on }),

  apply: async () => {
    if (get().restarting) return
    set({ confirmOpen: false, restarting: true })
    try {
      await flushUiState()
      await api.restartApp()
      if (fallbackTimer) clearTimeout(fallbackTimer)
      fallbackTimer = setTimeout(() => {
        if (!get().restarting) return
        set({ restarting: false })
        toast.error('还没有重启完成，请手动关闭窗口后重新打开')
      }, 25000)
    } catch (error) {
      set({ restarting: false })
      toast.error('重启失败：' + (error instanceof Error ? error.message : String(error)))
    }
  },
}))
