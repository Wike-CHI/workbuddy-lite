import { create } from 'zustand'

interface UiState {
  usageOpen: boolean
  workspaceOpen: boolean
  marketOpen: boolean
  setUsageOpen: (open: boolean) => void
  setWorkspaceOpen: (open: boolean) => void
  setMarketOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  usageOpen: false,
  workspaceOpen: false,
  marketOpen: false,
  setUsageOpen: (open) => set({ usageOpen: open }),
  setWorkspaceOpen: (open) => set({ workspaceOpen: open }),
  setMarketOpen: (open) => set({ marketOpen: open }),
}))
