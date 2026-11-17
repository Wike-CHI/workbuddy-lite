import { loadUiState, type UiStateSnapshot } from '@/lib/uiState'
import { useChatStore } from './chat'
import { useWorkbenchStore, type WorkbenchTab } from './workbench'

const TABS: WorkbenchTab[] = ['files', 'diff', 'plan', 'todos', 'git', 'tasks', 'browser']

// 重启后先把上一进程的界面状态放回 store，再跑 chat.init / team.loadState
export async function restoreUiState(): Promise<UiStateSnapshot> {
  const state = await loadUiState()

  if (state.chat && typeof state.chat === 'object') {
    const chat = state.chat
    const config = chat.config && typeof chat.config === 'object' ? chat.config : {}
    useChatStore.setState({
      model: typeof chat.model === 'string' ? chat.model : '',
      modelTouched: !!chat.model,
      mode: typeof chat.mode === 'string' && chat.mode ? chat.mode : 'fullAccess',
      modeTouched: !!chat.mode,
      thoughtLevel: typeof chat.thought === 'string' ? chat.thought : '',
      thoughtTouched: !!chat.thought,
      configValues: config,
      configTouched: Object.fromEntries(Object.keys(config).map((key) => [key, true as const])),
    })
  }

  if (state.workbench && typeof state.workbench === 'object') {
    const wb = state.workbench
    const tab = TABS.includes(wb.tab as WorkbenchTab) ? (wb.tab as WorkbenchTab) : 'files'
    const width = Math.min(720, Math.max(300, Number(wb.width) || 380))
    useWorkbenchStore.setState({ open: !!wb.open, width, tab })
  }

  return state
}
