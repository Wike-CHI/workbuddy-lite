import {
  Bot,
  ChevronsRight,
  FileDiff,
  FolderTree,
  GitBranch,
  Globe,
  Info,
  ListChecks,
  ListTodo,
  Plus,
  Share2,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { downloadText, safeFileName, sessionToHtml, sessionToMarkdown } from '@/lib/exportSession'
import { leafOf } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'
import { useUiStore } from '@/store/ui'
import { useWorkbenchStore, type WorkbenchTab } from '@/store/workbench'

import { BrowserPanel } from './BrowserPanel'
import { DiffPanel } from './DiffPanel'
import { FilesPanel } from './FilesPanel'
import { GitPanel } from './GitPanel'
import { PlanPanel, TodosPanel, planInfo, todoStats } from './PlanPanel'
import { TasksPanel, agentRuns, workflowRuns } from './TasksPanel'

const TABS: { id: WorkbenchTab; label: string; icon: typeof FolderTree }[] = [
  { id: 'files', label: '文件', icon: FolderTree },
  { id: 'diff', label: '变更', icon: FileDiff },
  { id: 'plan', label: '计划', icon: ListChecks },
  { id: 'todos', label: '待办', icon: ListTodo },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'tasks', label: '任务', icon: Bot },
  { id: 'browser', label: '网页', icon: Globe },
]

function DetailsPopover() {
  const workspaceName = useChatStore((s) => s.workspaceName)
  const workspaceFolders = useChatStore((s) => s.workspaceFolders)
  const activeTitle = useChatStore((s) => s.activeTitle)
  const model = useChatStore((s) => s.model)
  const contextUsed = useChatStore((s) => s.contextUsed)
  const contextSize = useChatStore((s) => s.contextSize)
  const credits = useChatStore((s) => s.credits)
  const git = useWorkbenchStore((s) => s.git)
  const refreshGit = useWorkbenchStore((s) => s.refreshGit)
  const setWorkspaceOpen = useUiStore((s) => s.setWorkspaceOpen)

  return (
    <Popover
      onOpenChange={(next) => {
        if (next) void refreshGit()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="详情：工作空间、改动归属、模型与用量"
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-3">
        <div className="text-[11px] font-medium text-muted-foreground">当前工作空间</div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{workspaceName || '—'}</span>
          <Badge variant="secondary">{workspaceFolders.length || 1} 个文件夹</Badge>
        </div>

        <div className="mt-2 space-y-1">
          {(workspaceFolders.length ? workspaceFolders : []).map((folder, index) => {
            const stat = git?.folders.find((item) => item.path === folder)
            return (
              <div key={folder} className="rounded-md border border-border/70 px-2 py-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 shrink-0 text-[10px] text-muted-foreground">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px]" title={folder}>
                    {leafOf(folder)}
                  </span>
                  {stat?.isRepo ? (
                    <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground">{stat.branch}</span>
                  ) : (
                    <span className="shrink-0 text-[9.5px] text-muted-foreground">非 git</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 pl-4 text-[9.5px] text-muted-foreground">
                  <span className="truncate" title={folder}>
                    {folder}
                  </span>
                  {stat && <span className="ml-auto shrink-0">{stat.files.length} 处改动</span>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          <div className="flex justify-between">
            <span>会话</span>
            <span className="max-w-[180px] truncate text-foreground">{activeTitle || '新会话'}</span>
          </div>
          <div className="mt-0.5 flex justify-between">
            <span>模型</span>
            <span className="font-mono text-foreground">{model || '—'}</span>
          </div>
          <div className="mt-0.5 flex justify-between">
            <span>上下文</span>
            <span className="font-mono text-foreground">
              {contextUsed ? `${Math.round(contextUsed / 1000)}k / ${Math.round(contextSize / 1000)}k` : '—'}
            </span>
          </div>
          <div className="mt-0.5 flex justify-between">
            <span>累计积分</span>
            <span className="font-mono text-foreground">{credits ? credits.toFixed(2) : '—'}</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-7 w-full gap-1 text-[11px] font-normal"
          onClick={() => setWorkspaceOpen(true)}
        >
          <Plus className="size-3" />
          新建 / 管理工作空间
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function SharePopover() {
  const messages = useChatStore((s) => s.messages)
  const activeTitle = useChatStore((s) => s.activeTitle)
  const workspaceName = useChatStore((s) => s.workspaceName)
  const model = useChatStore((s) => s.model)

  const build = React.useCallback(
    () =>
      sessionToMarkdown(messages, {
        title: activeTitle || '会话',
        workspace: workspaceName,
        model,
        createdAt: Date.now(),
      }),
    [messages, activeTitle, workspaceName, model],
  )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="分享：导出或复制这个会话"
        >
          <Share2 className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[220px] p-1.5">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-muted"
          onClick={() => {
            const md = build()
            downloadText(`${safeFileName(activeTitle)}.md`, md, 'text/markdown;charset=utf-8')
            toast.success('已导出 Markdown')
          }}
        >
          导出 Markdown
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-muted"
          onClick={() => {
            const md = build()
            downloadText(`${safeFileName(activeTitle)}.html`, sessionToHtml(md, activeTitle || '会话'), 'text/html;charset=utf-8')
            toast.success('已导出 HTML')
          }}
        >
          导出 HTML
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-muted"
          onClick={async () => {
            await navigator.clipboard.writeText(build())
            toast.success('已复制为 Markdown')
          }}
        >
          复制 Markdown
        </button>
      </PopoverContent>
    </Popover>
  )
}

export function RightPanel() {
  const open = useWorkbenchStore((s) => s.open)
  const width = useWorkbenchStore((s) => s.width)
  const tab = useWorkbenchStore((s) => s.tab)
  const setTab = useWorkbenchStore((s) => s.setTab)
  const setWidth = useWorkbenchStore((s) => s.setWidth)
  const toggle = useWorkbenchStore((s) => s.toggle)
  const git = useWorkbenchStore((s) => s.git)
  const events = useChatStore((s) => s.events)

  const tasksRunning = React.useMemo(
    () =>
      agentRuns(events).filter((run) => run.status === 'in_progress' || run.status === 'running').length +
      workflowRuns(events).filter((run) => run.status === 'running').length,
    [events],
  )
  const todos = React.useMemo(() => todoStats(planInfo(events).entries), [events])

  if (!open) return null

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const move = (ev: MouseEvent) => setWidth(startWidth + (startX - ev.clientX))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const badgeFor = (id: WorkbenchTab) => {
    if (id === 'diff' || id === 'git') return git?.changed || 0
    if (id === 'tasks') return tasksRunning
    if (id === 'todos') return todos.total ? todos.total - todos.done : 0
    return 0
  }

  return (
    <aside className="relative flex shrink-0 flex-col border-l border-border bg-background" style={{ width }}>
      <div
        onMouseDown={startResize}
        className="absolute -left-[2px] top-0 z-10 h-full w-[4px] cursor-col-resize hover:bg-primary/30"
      />

      <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
        <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {TABS.map((item) => {
            const badge = badgeFor(item.id)
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                onClick={() => setTab(item.id)}
                className={cn(
                  'flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] transition-colors',
                  active
                    ? 'bg-surface text-ink ring-1 ring-border'
                    : 'text-ink-4 hover:bg-surface-2 hover:text-ink-2',
                )}
              >
                {item.label}
                {badge > 0 && (
                  <span className={cn('text-[9.5px] tabular-nums', active ? 'text-ink-2' : 'text-ink-4')}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <DetailsPopover />
          <SharePopover />
          <button
            type="button"
            className="grid size-6 place-items-center rounded text-ink-4 hover:bg-surface-2 hover:text-ink-2"
            title="收起右栏（Ctrl B）"
            onClick={() => toggle(false)}
          >
            <ChevronsRight className="size-3.5" />
          </button>
        </div>
      </div>

      {tab === 'files' && <FilesPanel />}
      {tab === 'diff' && <DiffPanel />}
      {tab === 'plan' && <PlanPanel />}
      {tab === 'todos' && <TodosPanel />}
      {tab === 'git' && <GitPanel />}
      {tab === 'tasks' && <TasksPanel />}
      {tab === 'browser' && <BrowserPanel />}
    </aside>
  )
}
