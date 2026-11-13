import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import {
  ArrowLeftRight,
  ChevronDown,
  Copy,
  FileText,
  Globe,
  Pencil,
  Play,
  Search,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { FilePreview } from '@/components/files/FilePreview'
import { cn } from '@/lib/utils'
import type { ToolArtifact } from '@/lib/types'

const KIND_ICON: Record<string, typeof Wrench> = {
  edit: Pencil,
  execute: Play,
  read: FileText,
  search: Search,
  fetch: Globe,
  delete: Trash2,
  move: ArrowLeftRight,
}

const STATUS_TEXT: Record<string, string> = {
  pending: '待执行',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

function statusClass(status: string) {
  if (status === 'completed') return 'bg-[#eaf7f0] text-[#1a9f60]'
  if (status === 'failed' || status === 'cancelled') return 'bg-[#fdeeee] text-destructive'
  if (status === 'in_progress') return 'bg-warning-soft text-warning'
  return 'bg-muted text-muted-foreground'
}

function contentBlocks(content: unknown) {
  if (!Array.isArray(content)) return []
  return content.filter((block) => block && typeof block === 'object')
}

function DiffBlock({ block }: { block: any }) {
  const oldLines = String(block.oldText || '').split('\n')
  const newLines = String(block.newText || '').split('\n')
  const rows: { type: 'add' | 'del'; text: string }[] = []
  oldLines.forEach((line) => {
    if (line !== '' || oldLines.length > 1) rows.push({ type: 'del', text: line })
  })
  newLines.forEach((line) => {
    if (line !== '' || newLines.length > 1) rows.push({ type: 'add', text: line })
  })
  return (
    <div className="overflow-hidden rounded-lg border border-border font-mono text-[11.5px] leading-[1.55]">
      <div className="border-b border-border bg-muted/40 px-2.5 py-1 text-muted-foreground">{block.path || ''}</div>
      {rows.map((row, index) => (
        <div
          key={index}
          className={cn(
            'whitespace-pre-wrap break-all px-2.5 py-0.5',
            row.type === 'add' ? 'bg-[#f0fbf4] text-[#17663f]' : 'bg-[#fdf2f2] text-[#8f2d2d]',
          )}
        >
          {row.type === 'add' ? '+ ' : '- '}
          {row.text}
        </div>
      ))}
    </div>
  )
}

export function ToolPart(props: ToolCallMessagePartProps) {
  const artifact = (props.artifact || {}) as ToolArtifact
  const status = String(artifact.status || (props.isError ? 'failed' : props.result ? 'completed' : 'pending'))
  const title = String(artifact.title || props.toolName || '工具调用')
  const kind = String(artifact.kind || props.toolName || 'tool')
  const Icon = KIND_ICON[kind] || Wrench
  const blocks = contentBlocks(artifact.content)
  const hasBody = Boolean(artifact.rawInput || blocks.length || artifact.rawOutput || artifact.file)
  const [open, setOpen] = useState(hasBody)
  const [copied, setCopied] = useState(false)

  const inputText = useMemo(() => {
    if (!artifact.rawInput) return ''
    try {
      return JSON.stringify(artifact.rawInput, null, 2)
    } catch {
      return String(artifact.rawInput)
    }
  }, [artifact.rawInput])

  const copyInput = async () => {
    try {
      await navigator.clipboard.writeText(inputText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[12.5px] font-medium text-foreground">{title}</span>
          <ChevronDown className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', statusClass(status))}>
          {STATUS_TEXT[status] || status}
        </span>
      </div>
      {open && hasBody && (
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          {inputText && (
            <div className="relative">
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/40 p-2.5 pr-9 font-mono text-[11.5px] leading-5 text-muted-foreground">
                {inputText}
              </pre>
              <button
                type="button"
                onClick={copyInput}
                title="复制参数"
                className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
              >
                <Copy className="size-3" />
              </button>
              {copied && <span className="absolute right-8 top-1.5 text-[10px] text-success">已复制</span>}
            </div>
          )}
          {blocks.map((block: any, index: number) => {
            if (block.type === 'diff') return <DiffBlock key={index} block={block} />
            if (block.type === 'text')
              return (
                <div key={index} className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5 text-muted-foreground">
                  {String(block.text || '')}
                </div>
              )
            if (block.type === 'link')
              return (
                <a
                  key={index}
                  href={block.uri}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs text-primary hover:underline"
                >
                  {block.name || block.uri}
                </a>
              )
            return null
          })}
          {artifact.rawOutput ? (
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/40 p-2.5 font-mono text-[11.5px] leading-5 text-muted-foreground">
              {typeof artifact.rawOutput === 'string' ? artifact.rawOutput : JSON.stringify(artifact.rawOutput, null, 2)}
            </pre>
          ) : null}
          <FilePreview file={artifact.file} />
        </div>
      )}
    </div>
  )
}
