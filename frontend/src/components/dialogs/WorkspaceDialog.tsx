import { FolderGit2, FolderOpen, FolderPlus, Plus, RefreshCw } from 'lucide-react'
import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { leafOf } from '@/lib/format'
import { useChatStore } from '@/store/chat'
import { useUiStore } from '@/store/ui'

const SOURCE_LABEL: Record<string, string> = {
  current: '当前',
  recent: '最近',
  codebuddy: 'CodeBuddy',
  workbuddy: 'WorkBuddy',
  session: '会话',
  subdir: '子目录',
  custom: '自建',
}

export function WorkspaceDialog() {
  const open = useUiStore((s) => s.workspaceOpen)
  const setOpen = useUiStore((s) => s.setWorkspaceOpen)
  const cwd = useChatStore((s) => s.cwd)
  const workspaces = useChatStore((s) => s.workspaces)
  const loadWorkspaces = useChatStore((s) => s.loadWorkspaces)
  const useWorkspace = useChatStore((s) => s.useWorkspace)
  const openWorkspace = useChatStore((s) => s.openWorkspace)
  const pickWorkspace = useChatStore((s) => s.pickWorkspace)
  const createWorkspace = useChatStore((s) => s.createWorkspace)
  const [path, setPath] = React.useState('')
  const [filter, setFilter] = React.useState('')
  const [newName, setNewName] = React.useState('')
  const [newParent, setNewParent] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setPath(cwd)
    void loadWorkspaces()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cwd])

  const filtered = workspaces.filter((workspace) => {
    if (workspace.current) return false
    const q = filter.trim().toLowerCase()
    if (!q) return true
    const source = SOURCE_LABEL[workspace.source] || workspace.source || ''
    return `${workspace.label || ''} ${workspace.path || ''} ${source}`.toLowerCase().includes(q)
  })

  const browse = async () => {
    const picked = await pickWorkspace()
    if (picked) setPath(picked)
  }

  const switchTo = async () => {
    const target = path.trim()
    if (!target) return
    const ok = await useWorkspace(target)
    if (ok) setOpen(false)
  }

  const browseParent = async () => {
    const picked = await pickWorkspace()
    if (picked) setNewParent(picked)
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    const created = await createWorkspace(name, newParent || undefined)
    if (created) {
      setNewName('')
      setNewParent('')
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[720px]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 pr-12">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FolderGit2 className="size-4 text-primary" />
            工作空间
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] font-normal"
            onClick={() => void loadWorkspaces()}
          >
            <RefreshCw className="size-3" />
            重新读取
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="rounded-xl border border-[#d6e3fb] bg-accent px-3 py-2.5">
            <div className="text-[10.5px] text-[#5b7bb5]">当前工作空间</div>
            <div className="mt-0.5 break-all font-mono text-[12px] text-accent-foreground">{cwd || '—'}</div>
          </div>

          <div className="mt-3 flex gap-1.5">
            <Input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void switchTo()
                }
              }}
              placeholder="输入、粘贴，或点「浏览」选一个工作文件夹"
              className="h-9 flex-1 font-mono text-xs"
            />
            <Button type="button" variant="outline" className="h-9 gap-1 px-3 text-xs" onClick={() => void browse()}>
              <FolderOpen className="size-3.5" />
              浏览
            </Button>
            <Button
              type="button"
              className="h-9 gap-1 px-3 text-xs"
              disabled={!path.trim()}
              onClick={() => void switchTo()}
            >
              切换
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-1 px-3 text-xs"
              onClick={async () => {
                await openWorkspace(path.trim() || cwd)
                setOpen(false)
              }}
            >
              <Plus className="size-3.5" />
              新窗口
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            「切换」把这个窗口的后续会话放到选中的文件夹，并记住它，下次启动直接回来；「新窗口」会开一个独立进程，两个工作空间互不干扰。列表包含 CodeBuddy / WorkBuddy 历史项目、最近会话、工作目录子目录，以及你自己新建的工作空间。
          </p>

          <div className="mt-3 rounded-xl border border-dashed border-border px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10.5px] font-medium text-muted-foreground">新建空白工作空间</div>
              <button
                type="button"
                className="inline-flex max-w-[300px] items-center gap-1 truncate rounded-md border border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => void browseParent()}
                title={newParent ? `创建到 ${newParent}` : '默认创建到 用户目录\\WorkBuddy'}
              >
                <FolderOpen className="size-3 shrink-0" />
                <span className="truncate">{newParent || '选择创建位置（默认：用户目录\\WorkBuddy）'}</span>
              </button>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void create()
                  }
                }}
                placeholder="文件夹名，例如 my-app"
                className="h-8 flex-1 text-xs"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0 gap-1 px-2.5 text-[11px]"
                disabled={!newName.trim()}
                onClick={() => void create()}
              >
                <FolderPlus className="size-3.5" />
                新建并切换
              </Button>
            </div>
            <p className="mt-1.5 text-[10.5px] leading-4 text-muted-foreground">
              建好的目录会记进工作空间列表，下次启动自动回到这个工作空间。
            </p>
          </div>

          <div className="mt-3">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="筛选工作空间（CodeBuddy / WorkBuddy / 路径）"
              className="h-8 text-xs"
            />
          </div>

          <div className="mt-2 space-y-1.5">
            {filtered.map((workspace) => (
                <div
                  key={workspace.path}
                  className="flex items-center gap-2.5 rounded-xl border border-border/70 px-2.5 py-2 transition-colors hover:border-border hover:bg-muted/20"
                >
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <FolderGit2 className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
                      <span className="truncate">{workspace.label || leafOf(workspace.path)}</span>
                      <Badge variant={workspace.source === 'current' ? 'success' : 'secondary'}>
                        {SOURCE_LABEL[workspace.source] || workspace.source}
                      </Badge>
                    </div>
                    <div className="truncate font-mono text-[10.5px] text-muted-foreground">{workspace.path}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px] font-normal"
                      onClick={async () => {
                        const ok = await useWorkspace(workspace.path)
                        if (ok) setOpen(false)
                      }}
                    >
                      切换
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={async () => {
                        await openWorkspace(workspace.path)
                        setOpen(false)
                      }}
                    >
                      新窗口
                    </Button>
                  </div>
                </div>
              ))}
            {!filtered.length && (
              <div className="py-6 text-center text-xs text-muted-foreground">还没有更多工作空间</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
