import { GitBranch, Minus, Plus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

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

export function GitPanel() {
  const git = useWorkbenchStore((s) => s.git)
  const loading = useWorkbenchStore((s) => s.gitLoading)
  const refreshGit = useWorkbenchStore((s) => s.refreshGit)
  const stage = useWorkbenchStore((s) => s.stage)
  const unstage = useWorkbenchStore((s) => s.unstage)
  const commit = useWorkbenchStore((s) => s.commit)

  const [messages, setMessages] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState('')

  React.useEffect(() => {
    void refreshGit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const repos = (git?.folders || []).filter((folder) => folder.isRepo)

  if (!git) {
    return <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">正在读取 git 状态…</div>
  }

  if (!repos.length) {
    return (
      <div className="px-4 py-6 text-center text-[11px] leading-5 text-muted-foreground">
        当前工作空间没有 git 仓库。
        <br />
        在文件夹里执行 <code className="rounded bg-muted px-1">git init</code> 后刷新即可。
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
        <span>
          共 {git.changed} 个改动 · 已暂存 {git.staged} · 未跟踪 {git.untracked}
        </span>
        <button type="button" className="hover:text-foreground" onClick={() => void refreshGit()}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      {repos.map((folder) => {
        const staged = folder.files.filter((f) => f.staged)
        const unstaged = folder.files.filter((f) => !f.staged)
        return (
          <div key={folder.path} className="border-b border-border/60 pb-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5">
              <GitBranch className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium" title={folder.path}>
                {folder.label}
              </span>
              <Badge variant="secondary" className="font-mono">
                {folder.branch || '—'}
              </Badge>
            </div>

            {folder.files.map((file) => (
              <div key={file.abs} className="group flex items-center gap-1.5 px-2.5 py-[3px] hover:bg-muted/40">
                <span className="w-3 shrink-0 font-mono text-[11px] text-warning">
                  {STATUS_LABEL[file.status] || 'M'}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px]" title={file.abs}>
                  {file.path}
                </span>
                <button
                  type="button"
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-card hover:text-foreground group-hover:opacity-100',
                  )}
                  title={file.staged ? '取消暂存' : '暂存这个文件'}
                  onClick={async () => {
                    setBusy(file.abs)
                    if (file.staged) await unstage(folder.path, [file.abs])
                    else await stage(folder.path, [file.abs])
                    setBusy('')
                  }}
                >
                  {file.staged ? <Minus className="size-3" /> : <Plus className="size-3" />}
                </button>
              </div>
            ))}

            <div className="mt-1.5 flex gap-1.5 px-2.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10.5px] font-normal"
                disabled={!unstaged.length || busy === folder.path}
                onClick={async () => {
                  setBusy(folder.path)
                  await stage(folder.path, [])
                  setBusy('')
                }}
              >
                全部暂存
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10.5px] font-normal"
                disabled={!staged.length || busy === folder.path}
                onClick={async () => {
                  setBusy(folder.path)
                  await unstage(folder.path, [])
                  setBusy('')
                }}
              >
                全部取消
              </Button>
              <span className="ml-auto self-center text-[10px] text-muted-foreground">
                已暂存 {staged.length}
              </span>
            </div>

            <div className="mt-1.5 px-2.5">
              <textarea
                value={messages[folder.path] || ''}
                onChange={(event) => setMessages({ ...messages, [folder.path]: event.target.value })}
                placeholder="提交信息，例如：fix: 修正工作空间切换"
                rows={2}
                className="w-full resize-none rounded-md border border-border bg-card px-2 py-1.5 text-[11.5px] outline-none focus:border-primary/50"
              />
              <Button
                type="button"
                size="sm"
                className="mt-1 h-6 w-full px-2 text-[10.5px]"
                disabled={!staged.length || !(messages[folder.path] || '').trim()}
                onClick={async () => {
                  setBusy(folder.path)
                  const ok = await commit(folder.path, (messages[folder.path] || '').trim())
                  setBusy('')
                  if (ok) {
                    toast.success('已提交')
                    setMessages({ ...messages, [folder.path]: '' })
                  } else {
                    toast.error('提交失败，检查是否有 git hooks 报错')
                  }
                }}
              >
                提交 {staged.length} 个已暂存文件
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
