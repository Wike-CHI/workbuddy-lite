import {
  Blocks,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  FolderGit2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2,
  Workflow,
} from 'lucide-react'
import * as React from 'react'

import { Input } from '@/components/ui/input'
import { ProjectAiDialog } from '@/components/ProjectAiDialog'
import { agentRuns } from '@/components/workbench/TasksPanel'
import { confirmToast } from '@/lib/confirmToast'
import { leafOf, relTime } from '@/lib/format'
import type { SessionSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'
import { useIntelligentUiStore } from '@/store/intelligentUi'
import { useUiStore } from '@/store/ui'
import { useWorkbenchStore } from '@/store/workbench'

function pathKey(path: string) {
  return String(path || '')
    .replace(/\//g, '\\')
    .toLowerCase()
    .replace(/\\+$/, '')
}

// 0 今天 / 1 昨天 / 2 过去 7 天 / 3 更早
function dayBucket(ts: number) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startOfToday) return 0
  if (ts >= startOfToday - 86_400_000) return 1
  if (ts >= startOfToday - 7 * 86_400_000) return 2
  return 3
}

const BUCKET_LABELS = ['今天', '昨天', '过去 7 天', '更早']

function isRunningStatus(status: string) {
  return status === 'in_progress' || status === 'running' || status === 'pending'
}

function highlightText(text: string, query: string) {
  if (!query) return text
  const index = text.toLowerCase().indexOf(query)
  if (index < 0) return text
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-[#fff3bf] px-0.5 text-foreground">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  )
}

export function Sidebar() {
  const sessions = useChatStore((s) => s.sessions)
  const projectNames = useChatStore((s) => s.projectNames)
  const activeId = useChatStore((s) => s.activeId)
  const cwd = useChatStore((s) => s.cwd)
  const workspaceName = useChatStore((s) => s.workspaceName)
  const workspaceFolders = useChatStore((s) => s.workspaceFolders)
  const loadSession = useChatStore((s) => s.loadSession)
  const newSession = useChatStore((s) => s.newSession)
  const switchWorkspace = useChatStore((s) => s.useWorkspace)
  const openWorkspace = useChatStore((s) => s.openWorkspace)
  const renameSession = useChatStore((s) => s.renameSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const status = useChatStore((s) => s.status)
  const agentReady = useChatStore((s) => s.agentReady)
  const agentError = useChatStore((s) => s.agentError)
  const demo = useChatStore((s) => s.demo)
  const quota = useChatStore((s) => s.quota)
  const events = useChatStore((s) => s.events)
  const focusTask = useWorkbenchStore((s) => s.focusTask)
  const setMarketOpen = useUiStore((s) => s.setMarketOpen)
  const setWorkspaceOpen = useUiStore((s) => s.setWorkspaceOpen)
  const setIntelligentUiOpen = useIntelligentUiStore((s) => s.setLibraryOpen)

  const [aiOpen, setAiOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draftTitle, setDraftTitle] = React.useState('')
  const [expandedOthers, setExpandedOthers] = React.useState<Set<string>>(() => new Set())
  const [cursor, setCursor] = React.useState(-1)

  const currentKey = pathKey(cwd)
  const q = query.trim().toLowerCase()

  const visible = React.useMemo(
    () => sessions.filter((s) => !q || (s.title || '').toLowerCase().includes(q)),
    [sessions, q],
  )

  const currentSessions = React.useMemo(
    () =>
      visible
        .filter((s) => !s.cwd || pathKey(s.cwd) === currentKey)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [visible, currentKey],
  )

  const buckets = React.useMemo(
    () =>
      BUCKET_LABELS.map((label, index) => ({
        label,
        items: currentSessions.filter((s) => dayBucket(s.updatedAt || 0) === index),
      })).filter((bucket) => bucket.items.length > 0),
    [currentSessions],
  )

  const others = React.useMemo(() => {
    const map = new Map<string, { key: string; path: string; sessions: SessionSummary[] }>()
    for (const session of visible) {
      const key = pathKey(session.cwd)
      if (!key || key === currentKey) continue
      if (!map.has(key)) map.set(key, { key, path: session.cwd, sessions: [] })
      map.get(key)!.sessions.push(session)
    }
    return [...map.values()]
      .map((group) => ({
        ...group,
        sessions: [...group.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
        updatedAt: Math.max(0, ...group.sessions.map((s) => s.updatedAt || 0)),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [visible, currentKey])

  const quotaPct = quota?.percent !== undefined ? Number(quota.percent) : null
  const dotClass = demo ? 'bg-warning animate-pulse' : agentReady ? 'bg-success' : 'bg-destructive'
  const statusText = demo ? '演示模式（未接真实模型）' : agentReady ? 'CodeBuddy 已就绪' : status || '正在启动 Agent…'

  const activeRuns = React.useMemo(() => agentRuns(events), [events])
  const flat = React.useMemo(
    () => [
      ...currentSessions,
      ...others.flatMap((group) => (expandedOthers.has(group.key) ? group.sessions : [])),
    ],
    [currentSessions, others, expandedOthers],
  )

  React.useEffect(() => setCursor(-1), [query])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'n') {
        event.preventDefault()
        newSession()
      } else if (key === 'k') {
        event.preventDefault()
        document.getElementById('session-search')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newSession])

  const toggleOther = (key: string) => {
    setExpandedOthers((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const openSession = async (session: SessionSummary) => {
    if (session.cwd && pathKey(session.cwd) !== currentKey) {
      await switchWorkspace(session.cwd)
    }
    await loadSession(session.id)
  }

  const newSessionIn = async (path: string) => {
    if (path && pathKey(path) !== currentKey) await switchWorkspace(path)
    newSession()
  }

  const startRename = (session: SessionSummary) => {
    setEditingId(session.id)
    setDraftTitle(session.title || '')
  }

  const commitRename = async (id: string) => {
    const next = draftTitle.trim()
    const before = sessions.find((s) => s.id === id)?.title || ''
    setEditingId(null)
    if (!next || next === before) return
    await renameSession(id, next)
  }

  const confirmDelete = async (session: SessionSummary) => {
    confirmToast({
      title: `删除会话「${session.title || '新会话'}」？`,
      description: '删除后无法恢复，会话记录会从列表里移除',
      confirmLabel: '删除',
      danger: true,
      onConfirm: async () => {
        await deleteSession(session.id)
      },
    })
  }

  const renderSession = (session: SessionSummary) => {
    const active = session.id === activeId
    const focused = cursor >= 0 && flat[cursor]?.id === session.id
    const sub = session.subagents
    const wf = session.workflows
    const runs = active ? activeRuns : []
    return (
      <div
        key={session.id}
        className={cn(
          'group relative rounded-md py-1.5 pl-2.5 pr-1 transition-colors',
          active ? 'bg-surface' : 'hover:bg-surface-3/60',
          focused && !active && 'bg-surface-3/60',
        )}
      >
        {active && <span className="absolute bottom-1.5 left-0 top-1.5 w-[2px] rounded-full bg-primary" />}
        <div className="flex items-center gap-1">
          {editingId === session.id ? (
            <input
              autoFocus
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={() => void commitRename(session.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void commitRename(session.id)
                } else if (event.key === 'Escape') {
                  setEditingId(null)
                }
              }}
              className="h-6 min-w-0 flex-1 rounded border border-primary/40 bg-surface px-1 text-[12px] text-ink outline-none"
            />
          ) : (
            <>
              <button type="button" onClick={() => void openSession(session)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'truncate text-[12.5px]',
                      active ? 'font-medium text-ink' : 'text-ink-2',
                    )}
                  >
                    {highlightText(session.title || '新会话', q)}
                  </span>
                  {sub && sub.running > 0 && (
                    <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-ink-4">
                  <span className="shrink-0">{relTime(session.updatedAt)}</span>
                  {sub && sub.count > 0 && (
                    <>
                      <span>·</span>
                      <span
                        className="flex shrink-0 items-center gap-0.5"
                        title={`${sub.count} 个子智能体 · 共 ${sub.steps} 步`}
                      >
                        <Bot className="size-2.5" />
                        {sub.count}
                      </span>
                    </>
                  )}
                  {wf && wf.total > 0 && (
                    <>
                      <span>·</span>
                      <span
                        className="flex shrink-0 items-center gap-0.5"
                        title={`工作流「${wf.name}」${wf.status ? ' · ' + wf.status : ''} · ${wf.done}/${wf.total}${
                          wf.phase ? ' · ' + wf.phase : ''
                        }`}
                      >
                        <Workflow className={cn('size-2.5', wf.running > 0 && 'animate-pulse text-primary')} />
                        流程 {wf.done}/{wf.total}
                      </span>
                    </>
                  )}
                  {session.model && (
                    <>
                      <span>·</span>
                      <span className="truncate font-mono">{session.model}</span>
                    </>
                  )}
                </div>
              </button>
              <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  title="重命名"
                  onClick={() => startRename(session)}
                  className="grid size-5 place-items-center rounded text-ink-4 hover:bg-surface-3 hover:text-ink"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  title="删除会话"
                  onClick={() => void confirmDelete(session)}
                  className="grid size-5 place-items-center rounded text-ink-4 hover:bg-surface-3 hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </>
          )}
        </div>

        {active && runs.length > 0 && (
          <div className="ml-0.5 mt-1 space-y-0.5 border-l border-border pl-2">
            {runs.slice(0, 4).map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => focusTask(run.id)}
                title="在右侧「任务」面板里查看这个子智能体"
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10.5px] text-ink-3 transition-colors hover:bg-surface-3/70 hover:text-ink-2"
              >
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    isRunningStatus(run.status) ? 'animate-pulse bg-primary' : 'bg-ok',
                  )}
                />
                <span className="truncate">{run.title}</span>
                <span className="ml-auto shrink-0 font-mono">{run.tools} 步</span>
              </button>
            ))}
            {runs.length > 4 && (
              <button
                type="button"
                onClick={() => focusTask(runs[4].id)}
                className="px-1 text-[10.5px] text-ink-4 hover:text-ink-2 hover:underline"
              >
                还有 {runs.length - 4} 个…
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-sidebar px-2 pb-2 pt-2">
      <button
        type="button"
        onClick={() => setWorkspaceOpen(true)}
        title={cwd ? `${workspaceName || ''}\n${cwd}` : '选择工作空间'}
        className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-surface-3/70"
      >
        <img src="/icon.svg" alt="WorkBuddy Lite" className="size-6 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium tracking-[-0.01em] text-ink">
            {workspaceName || '未命名工作空间'}
          </div>
          <div className="truncate text-[10.5px] text-ink-4">
            {workspaceFolders.length > 1 ? `${workspaceFolders.length} 个文件夹` : '1 个文件夹'}
          </div>
        </div>
        <ChevronsUpDown className="size-3 shrink-0 text-ink-4" />
      </button>

      <button
        id="new-session"
        type="button"
        onClick={newSession}
        className="mt-2 flex h-8 w-full items-center justify-between rounded-md px-2 text-[12.5px] text-ink-2 transition-colors hover:bg-surface-3/70 hover:text-ink"
      >
        <span className="flex items-center gap-1.5">
          <Plus className="size-3.5 text-ink-4" />
          新会话
        </span>
        <span className="font-mono text-[10px] text-ink-4">Ctrl N</span>
      </button>

      <div className="mt-1 flex items-center gap-1 px-0.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-ink-4" />
          <Input
            id="session-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setCursor((prev) => Math.min(flat.length - 1, prev + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setCursor((prev) => Math.max(-1, prev - 1))
              } else if (event.key === 'Enter' && cursor >= 0 && flat[cursor]) {
                event.preventDefault()
                void openSession(flat[cursor])
              } else if (event.key === 'Escape') {
                setQuery('')
                setCursor(-1)
              }
            }}
            placeholder={`搜索 ${sessions.length} 个会话`}
            className="h-7 border-transparent bg-surface-2/70 pl-7 text-[11.5px] shadow-none focus-visible:border-border"
          />
        </div>
        <button
          type="button"
          className="grid size-7 shrink-0 place-items-center rounded text-ink-4 transition-colors hover:bg-surface-3/70 hover:text-ink-2"
          title="AI 整理项目与会话"
          onClick={() => setAiOpen(true)}
        >
          <Wand2 className="size-3.5" />
        </button>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto pb-2">
        {buckets.map((bucket) => (
          <div key={bucket.label} className="mb-1">
            <div className="px-2 py-1.5 text-[10.5px] font-medium text-ink-4">{bucket.label}</div>
            <div className="space-y-px">{bucket.items.map(renderSession)}</div>
          </div>
        ))}

        {!buckets.length && !others.length && (
          <div className="px-2 py-8 text-center text-[11px] text-ink-4">
            {q ? (
              <button type="button" className="hover:text-ink-2 hover:underline" onClick={() => setQuery('')}>
                没有匹配的会话，清除搜索
              </button>
            ) : (
              '还没有会话，点上方「新会话」开始'
            )}
          </div>
        )}

        {others.length > 0 && (
          <div className="mt-1 border-t border-border/70 pt-1.5">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[10.5px] font-medium text-ink-4">其他项目</span>
              <button
                type="button"
                className="text-[10.5px] text-ink-4 hover:text-ink-2"
                onClick={() =>
                  setExpandedOthers((prev) =>
                    prev.size ? new Set() : new Set(others.map((group) => group.key)),
                  )
                }
              >
                {expandedOthers.size ? '全部收起' : '全部展开'}
              </button>
            </div>
            {others.map((group) => {
              const isOpen = expandedOthers.has(group.key)
              return (
                <div key={group.key}>
                  <div className="group flex items-center gap-0.5 rounded-md px-2 py-1 transition-colors hover:bg-surface-3/60">
                    <button
                      type="button"
                      onClick={() => toggleOther(group.key)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      title={group.path}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-3 shrink-0 text-ink-4" />
                      ) : (
                        <ChevronRight className="size-3 shrink-0 text-ink-4" />
                      )}
                      <FolderGit2 className="size-3.5 shrink-0 text-ink-4" />
                      <span className="truncate text-[12px] text-ink-2">
                        {projectNames[group.key] || leafOf(group.path)}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-ink-4">{group.sessions.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void newSessionIn(group.path)}
                      className="grid size-5 shrink-0 place-items-center rounded text-ink-4 opacity-0 transition-opacity hover:bg-surface-3 hover:text-ink group-hover:opacity-100"
                      title="切到这个项目并新建会话"
                    >
                      <Plus className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void openWorkspace(group.path)}
                      className="grid size-5 shrink-0 place-items-center rounded text-ink-4 opacity-0 transition-opacity hover:bg-surface-3 hover:text-ink group-hover:opacity-100"
                      title="在新窗口打开这个项目"
                    >
                      <ExternalLink className="size-3" />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="ml-3.5 mt-0.5 space-y-px border-l border-border pl-1.5">
                      {group.sessions.map(renderSession)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border/70 px-1.5 pb-0.5 pt-2">
        <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-ink-3">
          <span className={cn('size-1.5 shrink-0 rounded-full', dotClass)} />
          <span className="truncate" title={agentError || statusText}>
            {statusText}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-4">
            {quotaPct === null ? '—' : quotaPct.toFixed(quotaPct % 1 ? 1 : 0) + '%'}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-0.5">
          <button
            id="iui-library"
            type="button"
            className="flex h-6 flex-1 items-center justify-center gap-1 rounded text-[10.5px] text-ink-4 transition-colors hover:bg-surface-3/60 hover:text-ink-2"
            onClick={() => setIntelligentUiOpen(true, 'saved')}
          >
            <Sparkles className="size-3" />
            模板
          </button>
          <button
            type="button"
            className="flex h-6 flex-1 items-center justify-center gap-1 rounded text-[10.5px] text-ink-4 transition-colors hover:bg-surface-3/60 hover:text-ink-2"
            onClick={() => setMarketOpen(true)}
          >
            <Blocks className="size-3" />
            市场
          </button>
        </div>
      </div>

      <ProjectAiDialog open={aiOpen} onOpenChange={setAiOpen} />
    </aside>
  )
}
