import { ChevronDown, Coins, FolderGit2, Moon, PanelRight, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtCredits, fmtNum, fmtReset } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'
import { useThemeStore } from '@/store/theme'
import { useUiStore } from '@/store/ui'
import { useWorkbenchStore } from '@/store/workbench'

export function Topbar() {
  const demo = useChatStore((s) => s.demo)
  const cwd = useChatStore((s) => s.cwd)
  const workspaceName = useChatStore((s) => s.workspaceName)
  const workspaceFolders = useChatStore((s) => s.workspaceFolders)
  const activeTitle = useChatStore((s) => s.activeTitle)
  const credits = useChatStore((s) => s.credits)
  const quota = useChatStore((s) => s.quota)
  const contextUsed = useChatStore((s) => s.contextUsed)
  const contextSize = useChatStore((s) => s.contextSize)
  const setUsageOpen = useUiStore((s) => s.setUsageOpen)
  const setWorkspaceOpen = useUiStore((s) => s.setWorkspaceOpen)
  const panelOpen = useWorkbenchStore((s) => s.open)
  const togglePanel = useWorkbenchStore((s) => s.toggle)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)

  const ratio = contextSize > 0 ? Math.min(1, contextUsed / contextSize) : 0
  const circumference = 2 * Math.PI * 6

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <h1 className="truncate text-[13px] font-medium tracking-[-0.01em] text-foreground">
          {activeTitle || '新会话'}
        </h1>
        <span className="shrink-0 text-ink-4">/</span>
        <button
          id="cwd-chip"
          type="button"
          onClick={() => setWorkspaceOpen(true)}
          title={`工作空间：${workspaceName || '—'}\n${cwd || '—'}\n点击切换或新建`}
          className="inline-flex min-w-0 max-w-[260px] items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
        >
          <FolderGit2 className="size-3 shrink-0" />
          <span className="truncate">{workspaceName || cwd || '—'}</span>
          {workspaceFolders.length > 1 && (
            <span className="shrink-0 tabular-nums text-ink-4">{workspaceFolders.length}</span>
          )}
          <ChevronDown className="size-2.5 shrink-0 opacity-60" />
        </button>
        {demo && (
          <span className="shrink-0 rounded border border-warning/30 px-1.5 text-[10.5px] leading-[18px] text-warning">
            演示
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {contextSize > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="mr-1 flex items-center gap-1.5 text-[11px] tabular-nums text-ink-3">
                <svg viewBox="0 0 16 16" className="size-4 -rotate-90">
                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.18" />
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - ratio)}
                    className="text-primary transition-[stroke-dashoffset] duration-300"
                  />
                </svg>
                <span>{fmtNum(contextUsed)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              上下文 {fmtNum(contextUsed)} / {fmtNum(contextSize)}
            </TooltipContent>
          </Tooltip>
        )}

        {credits > 0 && (
        <button
          id="credit-btn"
          type="button"
          onClick={() => setUsageOpen(true)}
          title={
            quota?.percent !== undefined
              ? `累计 ${fmtCredits(credits)} 积分 · 预算已用 ${Number(quota.percent).toFixed(1)}% · 重置 ${fmtReset(quota.resetAt)}`
              : `累计 ${fmtCredits(credits)} 积分`
          }
          className="flex h-7 items-center gap-1 rounded px-1.5 text-[11px] tabular-nums text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
        >
          <Coins className="size-3" />
          {fmtCredits(credits)}
        </button>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleTheme}
              className="grid size-7 place-items-center rounded text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
              title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            >
              {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{theme === 'dark' ? '浅色主题' : '深色主题'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'size-7 rounded text-ink-3 hover:bg-surface-2 hover:text-ink-2',
                panelOpen && 'bg-surface-2 text-ink',
              )}
              onClick={() => togglePanel()}
            >
              <PanelRight className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>工作台 · Ctrl B</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
