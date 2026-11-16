import { ChevronDown, ChevronRight, Copy, File, Folder, FolderOpen, RotateCcw } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { leafOf } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useWorkbenchStore } from '@/store/workbench'

function iconFor(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'h', 'cs'].includes(ext))
    return 'text-[#3b6fd4]'
  if (['json', 'yaml', 'yml', 'toml', 'ini', 'cfg'].includes(ext)) return 'text-[#b07a1e]'
  if (['md', 'txt', 'log'].includes(ext)) return 'text-muted-foreground'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return 'text-[#8b5cf6]'
  return 'text-muted-foreground'
}

function TreeRows({ path, depth }: { path: string; depth: number }) {
  const tree = useWorkbenchStore((s) => s.tree)
  const expanded = useWorkbenchStore((s) => s.expanded)
  const toggleDir = useWorkbenchStore((s) => s.toggleDir)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const entries = tree[path] || []

  return (
    <>
      {entries.map((entry) => {
        const isOpen = expanded.includes(entry.path)
        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() => (entry.isDir ? void toggleDir(entry.path) : void openFile(entry.path))}
              className="flex w-full items-center gap-1 rounded px-1 py-[3px] text-left text-[12px] hover:bg-muted/60"
              style={{ paddingLeft: 6 + depth * 12 }}
              title={entry.path}
            >
              {entry.isDir ? (
                isOpen ? (
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                )
              ) : (
                <span className="size-3 shrink-0" />
              )}
              {entry.isDir ? (
                isOpen ? (
                  <FolderOpen className="size-3.5 shrink-0 text-[#c08a2e]" />
                ) : (
                  <Folder className="size-3.5 shrink-0 text-[#c08a2e]" />
                )
              ) : (
                <File className={cn('size-3.5 shrink-0', iconFor(entry.name))} />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            {entry.isDir && isOpen && <TreeRows path={entry.path} depth={depth + 1} />}
          </div>
        )
      })}
    </>
  )
}

function CodeView() {
  const file = useWorkbenchStore((s) => s.file)
  const loading = useWorkbenchStore((s) => s.fileLoading)
  const closeFile = useWorkbenchStore((s) => s.closeFile)
  const [copied, setCopied] = React.useState(false)

  if (!file) return null
  const lines = file.text.split('\n').slice(0, 3000)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground"
          onClick={closeFile}
        >
          <RotateCcw className="size-3" />
          返回
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={file.path}>
          {leafOf(file.path)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground"
          onClick={async () => {
            await navigator.clipboard.writeText(file.text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          <Copy className="size-3" />
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      {loading && <div className="px-3 py-4 text-[11px] text-muted-foreground">读取中…</div>}
      {file.error && <div className="px-3 py-4 text-[11px] text-destructive">{file.error}</div>}
      {!file.error && !loading && (
        <div className="min-h-0 flex-1 overflow-auto bg-background py-2 font-mono text-[11.5px] leading-[1.6]">
          {lines.map((line, index) => (
            <div key={index} className="flex px-2 hover:bg-muted/40">
              <span className="w-9 shrink-0 select-none pr-2 text-right text-[10px] text-muted-foreground/70">
                {index + 1}
              </span>
              <span className="whitespace-pre text-foreground">{line || ' '}</span>
            </div>
          ))}
          {file.truncated && (
            <div className="px-3 py-2 text-[10.5px] text-muted-foreground">文件较大，只显示前 300KB</div>
          )}
        </div>
      )}
    </div>
  )
}

export function FilesPanel() {
  const file = useWorkbenchStore((s) => s.file)
  const tree = useWorkbenchStore((s) => s.tree)
  const expanded = useWorkbenchStore((s) => s.expanded)
  const loadTree = useWorkbenchStore((s) => s.loadTree)
  const toggleDir = useWorkbenchStore((s) => s.toggleDir)

  React.useEffect(() => {
    if (!tree['']) void loadTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 打开面板先把第一个根目录展开，不要停在只有一个文件夹名
  React.useEffect(() => {
    const roots = tree[''] || []
    if (!roots.length || expanded.length) return
    void toggleDir(roots[0].path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree['']?.length])

  if (file) return <CodeView />

  const roots = tree[''] || []
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
      {!roots.length && <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">正在读取工作空间…</div>}
      <TreeRows path="" depth={0} />
    </div>
  )
}
