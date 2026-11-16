import { ChevronDown, FolderGit2, PanelRight, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtCredits, fmtNum, fmtReset, modelShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'
import { useUiStore } from '@/store/ui'
import { useWorkbenchStore } from '@/store/workbench'

const MODES = [
  { value: 'default', label: '每次询问' },
  { value: 'acceptEdits', label: '自动改文件' },
  { value: 'plan', label: '只读规划' },
  { value: 'auto', label: '自动审查' },
  { value: 'dontAsk', label: '不询问' },
  { value: 'bypassPermissions', label: '跳过权限' },
  { value: 'fullAccess', label: '完全放行' },
]

export function Topbar() {
  const demo = useChatStore((s) => s.demo)
  const cwd = useChatStore((s) => s.cwd)
  const workspaceName = useChatStore((s) => s.workspaceName)
  const workspaceFolders = useChatStore((s) => s.workspaceFolders)
  const activeTitle = useChatStore((s) => s.activeTitle)
  const model = useChatStore((s) => s.model)
  const models = useChatStore((s) => s.models)
  const mode = useChatStore((s) => s.mode)
  const setModel = useChatStore((s) => s.setModel)
  const setMode = useChatStore((s) => s.setMode)
  const credits = useChatStore((s) => s.credits)
  const quota = useChatStore((s) => s.quota)
  const contextUsed = useChatStore((s) => s.contextUsed)
  const contextSize = useChatStore((s) => s.contextSize)
  const setUsageOpen = useUiStore((s) => s.setUsageOpen)
  const setWorkspaceOpen = useUiStore((s) => s.setWorkspaceOpen)
  const panelOpen = useWorkbenchStore((s) => s.open)
  const togglePanel = useWorkbenchStore((s) => s.toggle)

  const currentModel = models.find((m) => m.id === model)
  const modelOptions = models.length
    ? models
    : model
      ? [{ id: model, name: model, credits: '', multiplier: 0, maxInputTokens: 0 }]
      : []
  const modeOptions = MODES.some((m) => m.value === mode) ? MODES : [...MODES, { value: mode, label: mode }]
  const circumference = 2 * Math.PI * 15
  const ratio = contextSize > 0 ? Math.min(1, contextUsed / contextSize) : 0

  return (
    <header className="flex h-[58px] shrink-0 items-center justify-between gap-3 border-b border-border/70 px-5">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">{activeTitle || '新会话'}</h1>
        <div className="mt-0.5 flex items-center gap-1.5">
          <button
            id="cwd-chip"
            type="button"
            onClick={() => setWorkspaceOpen(true)}
            title={`工作空间：${workspaceName || '—'}${workspaceFolders.length > 1 ? `（${workspaceFolders.length} 个文件夹）` : ''}\n${cwd || '—'}\n点击切换、编辑或新窗口打开`}
            className="inline-flex max-w-[420px] items-center gap-1 truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <FolderGit2 className="size-3 shrink-0" />
            <span className="truncate">{workspaceName || cwd || '—'}</span>
            {workspaceFolders.length > 1 && (
              <span className="shrink-0 rounded bg-background/70 px-1 text-[9.5px]">{workspaceFolders.length}</span>
            )}
            <ChevronDown className="size-2.5 shrink-0 opacity-60" />
          </button>
          {demo && (
            <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-[10.5px] text-warning">演示模式</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Select value={model} onValueChange={(value) => void setModel(value)}>
          <SelectTrigger className="h-8 max-w-[210px]" title="模型（含积分倍率）">
            <SelectValue placeholder={currentModel ? modelShort(currentModel) : '模型'} />
          </SelectTrigger>
          <SelectContent className="max-w-[300px]">
            {modelOptions.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {modelShort(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={mode} onValueChange={setMode}>
          <SelectTrigger className="h-8 max-w-[120px]" title="权限模式">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modeOptions.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <svg viewBox="0 0 36 36" className="size-6 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" stroke="#eef0f3" strokeWidth="4" />
                <circle
                  cx="18"
                  cy="18"
                  r="15"
                  fill="none"
                  stroke="#2f6feb"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - ratio)}
                  className="transition-[stroke-dashoffset] duration-500"
                />
              </svg>
              <span>{fmtNum(contextUsed)}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            上下文 {fmtNum(contextUsed)} / {fmtNum(contextSize)}
          </TooltipContent>
        </Tooltip>

        <Button
          id="credit-btn"
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2 font-mono text-[11px]"
          title={
            quota?.percent !== undefined
              ? `累计 ${fmtCredits(credits)} 积分 · 预算已用 ${Number(quota.percent).toFixed(1)}% · 重置 ${fmtReset(quota.resetAt)}`
              : `累计 ${fmtCredits(credits)} 积分`
          }
          onClick={() => setUsageOpen(true)}
        >
          <Sparkles className="size-3 text-warning" />
          <span>{fmtCredits(credits)}</span>
          <span className="text-muted-foreground">积分</span>
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={cn('size-8 shrink-0', panelOpen && 'border-primary/40 bg-accent text-accent-foreground')}
              onClick={() => togglePanel()}
            >
              <PanelRight className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>工作台（文件 / 变更 / 计划 / Git / 浏览器）</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
