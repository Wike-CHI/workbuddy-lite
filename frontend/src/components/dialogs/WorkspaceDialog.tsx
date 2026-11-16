import {
  Check,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { leafOf } from '@/lib/format'
import { confirmToast } from '@/lib/confirmToast'
import type { Workspace } from '@/lib/types'
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

const MAX_FOLDERS = 5

function samePath(a: string, b: string) {
  const norm = (p: string) =>
    String(p || '')
      .replace(/\//g, '\\')
      .toLowerCase()
      .replace(/\\+$/, '')
  return norm(a) === norm(b)
}

interface EditingState {
  id?: string
  name: string
  folders: string[]
}

export function WorkspaceDialog() {
  const open = useUiStore((s) => s.workspaceOpen)
  const setOpen = useUiStore((s) => s.setWorkspaceOpen)
  const cwd = useChatStore((s) => s.cwd)
  const workspaces = useChatStore((s) => s.workspaces)
  const workspaceId = useChatStore((s) => s.workspaceId)
  const workspaceName = useChatStore((s) => s.workspaceName)
  const workspaceFolders = useChatStore((s) => s.workspaceFolders)
  const loadWorkspaces = useChatStore((s) => s.loadWorkspaces)
  const useWorkspace = useChatStore((s) => s.useWorkspace)
  const useWorkspaceById = useChatStore((s) => s.useWorkspaceById)
  const openWorkspace = useChatStore((s) => s.openWorkspace)
  const pickWorkspace = useChatStore((s) => s.pickWorkspace)
  const saveWorkspace = useChatStore((s) => s.saveWorkspace)
  const removeWorkspace = useChatStore((s) => s.removeWorkspace)

  const [path, setPath] = React.useState('')
  const [filter, setFilter] = React.useState('')
  const [editing, setEditing] = React.useState<EditingState | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setPath(cwd)
    setEditing(null)
    void loadWorkspaces()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cwd])

  const filtered = workspaces.filter((workspace) => {
    if (workspace.current) return false
    const q = filter.trim().toLowerCase()
    if (!q) return true
    const source = SOURCE_LABEL[workspace.source] || workspace.source || ''
    const folders = (workspace.folders || []).join(' ')
    return `${workspace.label || ''} ${workspace.path || ''} ${source} ${folders}`.toLowerCase().includes(q)
  })
  const customList = filtered.filter((w) => w.id && w.source === 'custom')
  const otherList = filtered.filter((w) => !(w.id && w.source === 'custom'))

  const currentFolders = workspaceFolders.length ? workspaceFolders : cwd ? [cwd] : []

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

  const startEdit = (workspace: Workspace) => {
    setEditing({
      id: workspace.id,
      name: workspace.label || leafOf(workspace.path),
      folders: workspace.folders?.length ? [...workspace.folders] : [workspace.path],
    })
  }

  const startEditCurrent = () => {
    setEditing({ id: workspaceId, name: workspaceName || leafOf(cwd), folders: [...currentFolders] })
  }

  const startCreate = () => setEditing({ name: '', folders: [] })

  const addFolder = async () => {
    if (!editing || editing.folders.length >= MAX_FOLDERS) return
    const picked = await pickWorkspace()
    if (!picked) return
    if (editing.folders.some((f) => samePath(f, picked))) return
    setEditing({ ...editing, folders: [...editing.folders, picked] })
  }

  const removeFolder = (index: number) => {
    if (!editing) return
    setEditing({ ...editing, folders: editing.folders.filter((_, i) => i !== index) })
  }

  const submitEdit = async () => {
    if (!editing) return
    setSaving(true)
    const id = await saveWorkspace({
      id: editing.id,
      name: editing.name.trim(),
      folders: editing.folders,
    })
    setSaving(false)
    if (id) setEditing(null)
  }

  const editingInvalid = !editing || !editing.name.trim() || !editing.folders.length

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[760px]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 pr-12">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FolderGit2 className="size-4 text-primary" />
            工作空间
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] font-normal"
              onClick={startCreate}
            >
              <Plus className="size-3" />
              新建
            </Button>
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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="rounded-xl border border-[#d6e3fb] bg-accent px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] text-[#5b7bb5]">当前工作空间</div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-accent-foreground">
                    {workspaceName || '—'}
                  </span>
                  {currentFolders.length > 1 && (
                    <Badge variant="secondary">{currentFolders.length} 个文件夹</Badge>
                  )}
                </div>
                <div className="mt-1 space-y-0.5">
                  {currentFolders.map((folder, index) => (
                    <div
                      key={folder}
                      className="flex items-center gap-1 font-mono text-[10.5px] text-[#5b7bb5]"
                      title={folder}
                    >
                      <span className="shrink-0">{index + 1}.</span>
                      <span className="truncate">{folder}</span>
                    </div>
                  ))}
                </div>
              </div>
              {workspaceId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 text-[11px] font-normal"
                  onClick={startEditCurrent}
                >
                  <Pencil className="size-3" />
                  编辑
                </Button>
              )}
            </div>
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
            「切换」把这个窗口的后续会话放到选中的文件夹，并记住它，下次启动直接回来；「新窗口」会开一个独立进程。一个工作空间最多挂 5
            个文件夹，cwd 是第一个，其余目录会在提示里告诉模型。
          </p>

          {editing && (
            <div className="mt-3 rounded-xl border border-primary/30 bg-accent/40 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-medium text-foreground">
                  {editing.id ? '编辑工作空间' : '新建工作空间'}
                </div>
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setEditing(null)}
                  title="取消"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              <Input
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                placeholder="工作空间名称，例如 财务中台"
                className="mt-2 h-8 text-xs"
              />

              <div className="mt-2 space-y-1">
                {editing.folders.map((folder, index) => (
                  <div
                    key={folder}
                    className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2 py-1"
                  >
                    <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={folder}>
                      {folder}
                    </span>
                    <button
                      type="button"
                      className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => removeFolder(index)}
                      title="移除这个文件夹"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {!editing.folders.length && (
                  <div className="rounded-lg border border-dashed border-border px-2 py-2 text-[11px] text-muted-foreground">
                    还没有文件夹，点下面「添加文件夹」挑一个（最多 5 个）
                  </div>
                )}
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px] font-normal"
                  disabled={editing.folders.length >= MAX_FOLDERS}
                  onClick={() => void addFolder()}
                >
                  <FolderPlus className="size-3" />
                  添加文件夹（{editing.folders.length}/{MAX_FOLDERS}）
                </Button>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px] font-normal"
                    onClick={() => setEditing(null)}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 gap-1 px-2.5 text-[11px]"
                    disabled={saving || editingInvalid}
                    onClick={() => void submitEdit()}
                  >
                    <Check className="size-3" />
                    {editing.id ? '保存修改' : '创建并切换'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-3">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="筛选工作空间（名称 / 路径 / 文件夹）"
              className="h-8 text-xs"
            />
          </div>

          {customList.length > 0 && (
            <>
              <div className="mt-3 px-0.5 text-[10.5px] font-medium text-muted-foreground">我的工作空间</div>
              <div className="mt-1.5 space-y-1.5">
                {customList.map((workspace) => {
                  const folders = workspace.folders?.length ? workspace.folders : [workspace.path]
                  return (
                    <div
                      key={workspace.id || workspace.path}
                      className="flex items-center gap-2.5 rounded-xl border border-border/70 px-2.5 py-2 transition-colors hover:border-border hover:bg-muted/20"
                    >
                      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                        <FolderGit2 className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
                          <span className="truncate">{workspace.label || leafOf(workspace.path)}</span>
                          <Badge variant="secondary">{folders.length} 个文件夹</Badge>
                          {workspace.active && <Badge variant="success">当前</Badge>}
                        </div>
                        <div className="truncate font-mono text-[10.5px] text-muted-foreground" title={folders.join('\n')}>
                          {folders.join('  ·  ')}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px] font-normal"
                          onClick={async () => {
                            const ok = await useWorkspaceById(workspace.id!)
                            if (ok) setOpen(false)
                          }}
                        >
                          切换
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-[11px] font-normal"
                          onClick={() => startEdit(workspace)}
                        >
                          <Pencil className="size-3" />
                          编辑
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 px-0 text-muted-foreground hover:text-destructive"
                          title="删除工作空间（不删文件夹）"
                          onClick={() => {
                            confirmToast({
                              title: `删除工作空间「${workspace.label}」？`,
                              description: '只删除分组，文件夹和会话都不动',
                              confirmLabel: '删除',
                              danger: true,
                              onConfirm: async () => {
                                await removeWorkspace(workspace.id!)
                              },
                            })
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {otherList.length > 0 && (
            <>
              <div className="mt-4 px-0.5 text-[10.5px] font-medium text-muted-foreground">
                其他工作空间（CodeBuddy / 本机会话 / 子目录）
              </div>
              <div className="mt-1.5 space-y-1.5">
                {otherList.map((workspace) => (
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
                        <Badge variant="secondary">{SOURCE_LABEL[workspace.source] || workspace.source}</Badge>
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
              </div>
            </>
          )}

          {!filtered.length && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              没有匹配的工作空间，点右上角「新建」建一个
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
