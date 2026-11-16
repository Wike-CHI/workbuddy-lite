import { FileDiff, RotateCcw } from 'lucide-react'
import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkbenchStore } from '@/store/workbench'

const STATUS_LABEL: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  changed: 'C',
}

const STATUS_COLOR: Record<string, string> = {
  modified: 'text-warning',
  added: 'text-ok',
  deleted: 'text-destructive',
  renamed: 'text-[#8250df]',
  untracked: 'text-ink-3',
  changed: 'text-warning',
}

function DiffBody() {
  const diff = useWorkbenchStore((s) => s.diff)
  const loading = useWorkbenchStore((s) => s.diffLoading)
  const closeDiff = useWorkbenchStore((s) => s.closeDiff)
  if (!diff) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground"
          onClick={closeDiff}
        >
          <RotateCcw className="size-3" />
          返回
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={diff.path}>
          {diff.path}
        </span>
        {diff.staged && <Badge variant="secondary">已暂存</Badge>}
      </div>
      {loading && <div className="px-3 py-4 text-[11px] text-muted-foreground">读取 diff…</div>}
      {diff.error && <div className="px-3 py-4 text-[11px] text-destructive">{diff.error}</div>}
      {diff.binary && <div className="px-3 py-4 text-[11px] text-muted-foreground">二进制文件，无法显示 diff</div>}
      {!diff.error && !diff.binary && !loading && (
        <div className="min-h-0 flex-1 overflow-auto bg-background py-2 font-mono text-[11px] leading-[1.6]">
          {diff.diff.split('\n').map((line, index) => {
            const added = line.startsWith('+') && !line.startsWith('+++')
            const removed = line.startsWith('-') && !line.startsWith('---')
            const hunk = line.startsWith('@@')
            return (
              <div
                key={index}
                className={cn(
                  'whitespace-pre px-2',
                  added && 'bg-[#e6ffec] text-ok',
                  removed && 'bg-[#ffebe9] text-destructive',
                  hunk && 'bg-accent text-primary',
                )}
              >
                {line || ' '}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function DiffPanel() {
  const git = useWorkbenchStore((s) => s.git)
  const loading = useWorkbenchStore((s) => s.gitLoading)
  const refreshGit = useWorkbenchStore((s) => s.refreshGit)
  const openDiff = useWorkbenchStore((s) => s.openDiff)
  const diff = useWorkbenchStore((s) => s.diff)

  React.useEffect(() => {
    void refreshGit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (diff) return <DiffBody />

  const repos = (git?.folders || []).filter((folder) => folder.isRepo)
  const files = repos.flatMap((folder) => folder.files.map((file) => ({ folder, file })))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
        <span>
          {loading ? '读取中…' : files.length ? `${files.length} 个改动` : '没有未提交的改动'}
        </span>
        <button type="button" className="hover:text-foreground" onClick={() => void refreshGit()}>
          刷新
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!git && <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">正在读取 git 状态…</div>}
        {git && !repos.length && (
          <div className="px-3 py-6 text-center text-[11px] leading-5 text-muted-foreground">
            当前工作空间不是 git 仓库。
            <br />
            会话里工具产生的 diff 仍会在消息流里显示。
          </div>
        )}
        {repos.map((folder) =>
          folder.files.length ? (
            <div key={folder.path} className="border-b border-border/60 py-1">
              <div className="flex items-center gap-1.5 px-2.5 py-1 text-[10.5px] text-muted-foreground">
                <FileDiff className="size-3" />
                <span className="truncate">{folder.label}</span>
                <span className="font-mono">{folder.branch}</span>
              </div>
              {folder.files.map((file) => (
                <button
                  key={file.abs}
                  type="button"
                  onClick={() => void openDiff(file.abs, file.staged)}
                  className="flex w-full items-center gap-2 px-2.5 py-1 text-left hover:bg-muted/50"
                  title={file.abs}
                >
                  <span className={cn('w-3 shrink-0 font-mono text-[11px]', STATUS_COLOR[file.status])}>
                    {STATUS_LABEL[file.status] || 'M'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{file.path}</span>
                  {file.staged && <span className="shrink-0 text-[9.5px] text-muted-foreground">已暂存</span>}
                </button>
              ))}
            </div>
          ) : null,
        )}
      </div>
    </div>
  )
}
