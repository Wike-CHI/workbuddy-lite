import {
  Blocks,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderGit2,
  Plus,
  Sparkles,
  Wand2,
} from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { ProjectAiDialog } from '@/components/ProjectAiDialog'
import { fmtReset, leafOf, relTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'
import { useIntelligentUiStore } from '@/store/intelligentUi'
import { useUiStore } from '@/store/ui'
import type { SessionSummary } from '@/lib/types'

function pathKey(path: string) {
  return String(path || '')
    .replace(/\//g, '\\')
    .toLowerCase()
    .replace(/\\+$/, '')
}

export function Sidebar() {
  const sessions = useChatStore((s) => s.sessions)
  const projectNames = useChatStore((s) => s.projectNames)
  const activeId = useChatStore((s) => s.activeId)
  const cwd = useChatStore((s) => s.cwd)
  const loadSession = useChatStore((s) => s.loadSession)
  const newSession = useChatStore((s) => s.newSession)
  const useWorkspace = useChatStore((s) => s.useWorkspace)
  const openWorkspace = useChatStore((s) => s.openWorkspace)
  const status = useChatStore((s) => s.status)
  const agentReady = useChatStore((s) => s.agentReady)
  const agentError = useChatStore((s) => s.agentError)
  const demo = useChatStore((s) => s.demo)
  const model = useChatStore((s) => s.model)
  const models = useChatStore((s) => s.models)
  const quota = useChatStore((s) => s.quota)
  const setMarketOpen = useUiStore((s) => s.setMarketOpen)
  const setIntelligentUiOpen = useIntelligentUiStore((s) => s.setLibraryOpen)

  const [aiOpen, setAiOpen] = React.useState(false)
  const currentKey = pathKey(cwd)
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(currentKey ? [currentKey] : []))

  React.useEffect(() => {
    if (currentKey) setExpanded((prev) => (prev.has(currentKey) ? prev : new Set(prev).add(currentKey)))
  }, [currentKey])

  const groups = React.useMemo(() => {
    const map = new Map<string, { key: string; path: string; sessions: SessionSummary[] }>()
    for (const session of sessions) {
      const key = pathKey(session.cwd) || 'unknown'
      if (!map.has(key)) map.set(key, { key, path: session.cwd || '未指定', sessions: [] })
      map.get(key)!.sessions.push(session)
    }
    return [...map.values()]
      .map((group) => ({
        ...group,
        sessions: [...group.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
        updatedAt: Math.max(0, ...group.sessions.map((s) => s.updatedAt || 0)),
      }))
      .sort((a, b) => {
        if (a.key === currentKey && b.key !== currentKey) return -1
        if (b.key === currentKey && a.key !== currentKey) return 1
        return b.updatedAt - a.updatedAt
      })
  }, [sessions, currentKey])

  const currentModel = models.find((m) => m.id === model)
  const quotaPct = quota?.percent !== undefined ? Number(quota.percent) : null
  const dotClass = demo ? 'bg-warning animate-pulse' : agentReady ? 'bg-success' : 'bg-destructive'
  const statusText = demo ? '演示模式（未接真实模型）' : agentReady ? 'CodeBuddy 已就绪' : status || '正在启动 Agent…'

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const openSession = async (session: SessionSummary) => {
    if (session.cwd && pathKey(session.cwd) !== currentKey) {
      await useWorkspace(session.cwd)
    }
    await loadSession(session.id)
  }

  const newSessionIn = async (path: string) => {
    if (path && path !== '未指定' && pathKey(path) !== currentKey) await useWorkspace(path)
    newSession()
  }

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-border bg-sidebar px-3 pb-2.5 pt-3.5">
      <div className="flex items-center gap-2.5 px-1.5 pb-3.5">
        <div className="size-8 shrink-0 overflow-hidden rounded-[9px]">
          <img src="/icon.svg" alt="WorkBuddy Lite" className="size-full" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-tight text-foreground">
            WorkBuddy <span className="font-semibold text-muted-foreground">Lite</span>
          </div>
          <div className="text-[10.5px] text-muted-foreground">React · WebView2 · ACP</div>
        </div>
      </div>

      <div className="flex gap-1.5">
        <Button
          id="new-session"
          type="button"
          variant="outline"
          className="h-9 flex-1 justify-center gap-1.5 rounded-[10px] text-[13px]"
          onClick={newSession}
        >
          <Plus className="size-3.5 text-muted-foreground" />
          新会话
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0 rounded-[10px] text-muted-foreground"
          title="AI 整理项目与会话"
          onClick={() => setAiOpen(true)}
        >
          <Wand2 className="size-4" />
        </Button>
      </div>

      <div className="mt-3 flex-1 space-y-1 overflow-y-auto pb-2">
        {groups.map((group) => {
          const isCurrent = group.key === currentKey
          const isOpen = expanded.has(group.key)
          const name = projectNames[group.key] || leafOf(group.path)
          return (
            <div key={group.key}>
              <div
                className={cn(
                  'group flex items-center gap-0.5 rounded-lg px-1 py-1 transition-colors',
                  isCurrent ? 'bg-accent/60' : 'hover:bg-[#f2f4f7]',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggle(group.key)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  title={group.path}
                >
                  {isOpen ? (
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <FolderGit2 className={cn('size-3.5 shrink-0', isCurrent ? 'text-primary' : 'text-muted-foreground')} />
                  <span className={cn('truncate text-[12px] font-medium', isCurrent ? 'text-accent-foreground' : 'text-foreground')}>
                    {name}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                    {group.sessions.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void newSessionIn(group.path)}
                  className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-card hover:text-foreground group-hover:opacity-100"
                  title="在此项目新建会话"
                >
                  <Plus className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void openWorkspace(group.path)}
                  className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-card hover:text-foreground group-hover:opacity-100"
                  title="在新窗口打开这个项目"
                >
                  <ExternalLink className="size-3" />
                </button>
              </div>

              {isOpen && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border/70 pl-1.5">
                  {group.sessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => void openSession(session)}
                      className={cn(
                        'flex w-full flex-col gap-0.5 rounded-[8px] border border-transparent px-2 py-1.5 text-left transition-colors',
                        session.id === activeId ? 'border-border bg-card shadow-sm' : 'hover:bg-[#f2f4f7]',
                      )}
                    >
                      <span className="truncate text-[12px] font-medium text-foreground">{session.title || '新会话'}</span>
                      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span>{relTime(session.updatedAt)}</span>
                        {session.model && <span className="truncate font-mono">{session.model}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {!groups.length && (
          <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">还没有会话，点上方「新会话」开始</div>
        )}
      </div>

      <div className="border-t border-sidebar-border px-1.5 pt-2.5">
        <div className="flex items-center gap-1.5 text-[11.5px] text-secondary-foreground">
          <span className={cn('size-1.5 shrink-0 rounded-full', dotClass)} />
          <span className="truncate" title={agentError || statusText}>
            {statusText}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span className="truncate">{currentModel ? currentModel.name : model || '—'}</span>
          <span
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
            title={quota?.resetAt ? `重置 ${fmtReset(quota.resetAt)}` : '发一条消息后读取额度'}
          >
            额度 {quotaPct === null ? '—' : quotaPct.toFixed(quotaPct % 1 ? 1 : 0) + '%'}
          </span>
        </div>
        <Button
          id="iui-library"
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-7 w-full justify-center gap-1 text-[11px] font-normal text-muted-foreground"
          onClick={() => setIntelligentUiOpen(true, 'saved')}
        >
          <Sparkles className="size-3" />
          交互回答 · 模板
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1 h-7 w-full justify-center gap-1 text-[11px] font-normal text-muted-foreground"
          onClick={() => setMarketOpen(true)}
        >
          <Blocks className="size-3" />
          技能 · 连接器 · 插件市场
        </Button>
      </div>

      <ProjectAiDialog open={aiOpen} onOpenChange={setAiOpen} />
    </aside>
  )
}
