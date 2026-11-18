import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { Composer } from '@/components/Composer'
import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import { ChatThread } from '@/components/chat/ChatThread'
import { AgentDetailDialog } from '@/components/team/AgentDetailDialog'
import { ChannelView } from '@/components/team/ChannelView'
import { CreateChannelDialog } from '@/components/team/CreateChannelDialog'
import { NewAgentDialog } from '@/components/team/NewAgentDialog'
import { MarketDialog } from '@/components/dialogs/MarketDialog'
import { UpdateDialog } from '@/components/dialogs/UpdateDialog'
import { IntelligentUiLibraryDialog } from '@/components/intelligent/IntelligentUiLibraryDialog'
import { UsageDialog } from '@/components/dialogs/UsageDialog'
import { WorkspaceDialog } from '@/components/dialogs/WorkspaceDialog'
import { RightPanel } from '@/components/workbench/RightPanel'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { restoreUiState } from '@/store/appState'
import { useAppUpdateStore } from '@/store/appUpdate'
import { useChatStore } from '@/store/chat'
import { useTeamStore } from '@/store/team'
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
  const activeChannelId = useTeamStore((s) => s.activeChannelId)
  const createChannelOpen = useTeamStore((s) => s.createOpen)
  const restarting = useAppUpdateStore((s) => s.restarting)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // 先恢复上一进程的界面状态，再走 bootstrap；否则 boot.model 会盖掉用户选择
      const restored = await restoreUiState()
      if (cancelled) return
      initTheme()
      void init()
      void useIntelligentUiStore.getState().load()
      // 团队区独立加载：CLI 没就绪或旧版本时只隐藏团队，不影响会话
      void (async () => {
        await useTeamStore.getState().loadState()
        if (cancelled || !restored.activeChannelId) return
        const team = useTeamStore.getState()
        if (team.channels.some((item) => item.id === restored.activeChannelId)) {
          await team.openChannel(restored.activeChannelId)
        } else {
          toast.info('上次的频道没有恢复，已回到会话列表')
        }
      })()
    })()
    void useAppUpdateStore.getState().check()
    const timer = setInterval(() => void useAppUpdateStore.getState().check(), 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
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
      openTeam: () => useTeamStore.getState().loadState(),
      newChannel: () => useTeamStore.getState().openCreate(),
      openChannel: (id: string) => useTeamStore.getState().openChannel(id),
      teamSend: (text: string) => useTeamStore.getState().send(text),
      mention: (agentId: string) => useTeamStore.getState().requestMentionPanel(agentId),
      // v2 验收钩子：成员面板 / bot 详情编辑 / 添加成员多选
      openMembers: () => useTeamStore.getState().openMembers(),
      editAgent: (agentId: string) => useTeamStore.getState().openAgentDetail(agentId),
      addMember: (agentId: string) => useTeamStore.getState().openAddMembers(agentId),
      openWorkbench: (tab: 'files' | 'diff' | 'plan' | 'todos' | 'git' | 'tasks' | 'browser' = 'files') => {
        const store = useWorkbenchStore.getState()
        store.toggle(true)
        store.setTab(tab)
      },
      browse: (url: string) => {
        useWorkbenchStore.getState().setBrowserUrl(url)
      },
      // 自动化用：跳过确认框直接走重启链路（截图/端到端测试）
      applyUpdate: () => useAppUpdateStore.getState().apply(),
      checkUpdate: () => useAppUpdateStore.getState().check(),
      previewRestartOverlay: (on = true) => useAppUpdateStore.getState().preview(on),
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
            {activeChannelId ? (
              <ChannelView />
            ) : (
              <>
                <ChatThread />
                <Composer />
              </>
            )}
          </main>
          <RightPanel />
        </div>
        {createChannelOpen && <CreateChannelDialog />}
        <AgentDetailDialog />
        <NewAgentDialog />
        <UsageDialog />
        <WorkspaceDialog />
        <MarketDialog />
        <IntelligentUiLibraryDialog />
        <UpdateDialog />
        {restarting && (
          <div
            id="app-update-overlay"
            className="fixed inset-0 z-[120] grid place-items-center bg-background/95 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-2.5 text-center">
              <Loader2 className="size-7 animate-spin text-primary" />
              <div className="text-sm font-medium text-foreground">正在重启 WorkBuddy Lite…</div>
              <div className="text-[11px] text-muted-foreground">
                会话和输入内容已保存，几秒后自动恢复
              </div>
            </div>
          </div>
        )}
        <Toaster />
      </TooltipProvider>
    </AssistantRuntimeProvider>
  )
}
