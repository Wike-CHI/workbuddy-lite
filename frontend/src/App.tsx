import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react'
import { useEffect } from 'react'

import { Composer } from '@/components/Composer'
import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import { ChatThread } from '@/components/chat/ChatThread'
import { MarketDialog } from '@/components/dialogs/MarketDialog'
import { IntelligentUiLibraryDialog } from '@/components/intelligent/IntelligentUiLibraryDialog'
import { UsageDialog } from '@/components/dialogs/UsageDialog'
import { WorkspaceDialog } from '@/components/dialogs/WorkspaceDialog'
import { RightPanel } from '@/components/workbench/RightPanel'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useChatStore } from '@/store/chat'
import { initTheme } from '@/store/theme'
import { useUiStore } from '@/store/ui'
import { useIntelligentUiStore } from '@/store/intelligentUi'
import { useWorkbenchStore } from '@/store/workbench'
import type { ChatMessage } from '@/lib/types'

// ThreadMessageLike 的 content 允许 data-* 部件，这里原样交给 assistant-ui 转换。
function convertMessage(message: ChatMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    content: message.parts as never,
    status: message.role === 'assistant' ? (message.status as never) : undefined,
    createdAt: new Date(message.createdAt),
  }
}

function useRuntime() {
  const messages = useChatStore((s) => s.messages)
  const running = useChatStore((s) => s.running)
  const send = useChatStore((s) => s.send)
  const cancel = useChatStore((s) => s.cancel)

  return useExternalStoreRuntime<ChatMessage>({
    messages,
    convertMessage,
    isRunning: running,
    onNew: async (message) => {
      const text = message.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      await send(text)
    },
    onCancel: async () => {
      await cancel()
    },
  })
}

export default function App() {
  const runtime = useRuntime()
  const boot = useChatStore((s) => s.boot)
  const agentError = useChatStore((s) => s.agentError)
  const init = useChatStore((s) => s.init)
  const togglePanel = useWorkbenchStore((s) => s.toggle)

  useEffect(() => {
    initTheme()
    void init()
    void useIntelligentUiStore.getState().load()
  }, [init])

  // Ctrl/Cmd + B 开合右栏（和 VS Code / Codex 一致）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'b') return
      event.preventDefault()
      togglePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePanel])

  // 截图/自动化验证用的钩子；正常使用不依赖它
  useEffect(() => {
    const w = window as unknown as { __wbl?: Record<string, unknown> }
    w.__wbl = {
      ...(w.__wbl || {}),
      send: (text: string) => useChatStore.getState().send(text),
      openUsage: () => useUiStore.getState().setUsageOpen(true),
      openWorkspace: () => useUiStore.getState().setWorkspaceOpen(true),
      openMarket: () => useUiStore.getState().setMarketOpen(true),
      openIuiLibrary: (tab: 'saved' | 'templates' = 'saved') => useIntelligentUiStore.getState().setLibraryOpen(true, tab),
      openWorkbench: (tab: 'files' | 'diff' | 'plan' | 'todos' | 'git' | 'tasks' | 'browser' = 'files') => {
        const store = useWorkbenchStore.getState()
        store.toggle(true)
        store.setTab(tab)
      },
      browse: (url: string) => {
        useWorkbenchStore.getState().setBrowserUrl(url)
      },
    }
  }, [])

  if (!boot && !agentError) {
    return (
      <div className="grid h-full place-items-center bg-background text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="size-10 animate-pulse rounded-xl bg-accent" />
          正在启动 WorkBuddy Lite…
        </div>
      </div>
    )
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider delayDuration={250}>
        <div className="flex h-full min-h-0 overflow-hidden">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col bg-background">
            <Topbar />
            {agentError && (
              <div className="border-b border-[#f3d0d0] bg-[#fdf4f4] px-5 py-2 text-xs text-[#8f2d2d]">
                Agent 未就绪：{agentError}
              </div>
            )}
            <ChatThread />
            <Composer />
          </main>
          <RightPanel />
        </div>
        <UsageDialog />
        <WorkspaceDialog />
        <MarketDialog />
        <IntelligentUiLibraryDialog />
        <Toaster />
      </TooltipProvider>
    </AssistantRuntimeProvider>
  )
}
