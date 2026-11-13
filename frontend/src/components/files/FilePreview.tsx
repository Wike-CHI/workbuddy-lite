import {
  Download,
  File,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Maximize2,
  Music,
  Presentation,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { FileKind, FileRef } from '@/lib/types'

import { DocxViewer } from './DocxViewer'
import { PptxViewer } from './PptxViewer'
import { XlsxViewer } from './XlsxViewer'

const KIND_LABEL: Record<FileKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  docx: 'Word',
  xlsx: 'Excel',
  pptx: 'PPT',
  pdf: 'PDF',
  other: '文件',
}

const ICONS: Record<FileKind, typeof File> = {
  image: ImageIcon,
  video: FileVideo,
  audio: Music,
  docx: FileText,
  xlsx: FileSpreadsheet,
  pptx: Presentation,
  pdf: FileText,
  other: File,
}

export function fileUrl(file: FileRef) {
  return '/api/file?path=' + encodeURIComponent(file.path)
}

function Glyph({ kind, className }: { kind: FileKind; className?: string }) {
  const Icon = ICONS[kind] || File
  return <Icon className={cn('size-4', className)} />
}

export function FilePreview({ file }: { file?: FileRef }) {
  const [open, setOpen] = React.useState(false)
  const [broken, setBroken] = React.useState(false)
  if (!file) return null
  const url = fileUrl(file)
  const isMedia = file.kind === 'image' || file.kind === 'video' || file.kind === 'audio'

  return (
    <>
      <div className="mt-2">
        {file.kind === 'image' && !broken ? (
          <button
            type="button"
            data-file-path={file.path}
            onClick={() => setOpen(true)}
            className="group relative block max-w-full overflow-hidden rounded-xl border border-border bg-muted/30"
            title="查看大图"
          >
            <img
              src={url}
              alt={file.name}
              loading="lazy"
              onError={() => setBroken(true)}
              className="max-h-64 max-w-full object-contain transition-transform group-hover:scale-[1.01]"
            />
            <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
              点击查看大图
            </span>
          </button>
        ) : file.kind === 'video' ? (
          <div className="relative overflow-hidden rounded-xl border border-border bg-black">
            <video src={url} controls preload="metadata" className="max-h-72 w-full" />
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="absolute right-2 top-2 rounded-md bg-black/55 p-1 text-white transition-colors hover:bg-black/70"
              title="全屏查看"
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>
        ) : file.kind === 'audio' ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5">
            <Music className="size-4 shrink-0 text-muted-foreground" />
            <audio src={url} controls className="h-8 min-w-0 flex-1" />
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            data-file-path={file.path}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setOpen(true)
              }
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card px-2.5 py-2 text-left transition-colors hover:border-[#cdd3dc] hover:bg-muted/30"
            title={file.kind === 'other' ? '下载文件' : '预览文件'}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Glyph kind={file.kind} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[12.5px] font-medium text-foreground">{file.name}</span>
                <Badge variant="secondary">{file.ext.toUpperCase()}</Badge>
              </span>
              <span className="block truncate text-[10.5px] text-muted-foreground">
                {KIND_LABEL[file.kind]} · 点击预览
              </span>
            </span>
            <a
              href={url}
              download={file.name}
              onClick={(event) => event.stopPropagation()}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              title="下载"
            >
              <Download className="size-3.5" />
            </a>
          </div>
        )}
      </div>

      {isMedia && open && (
        <MediaDialog file={file} url={url} open={open} onOpenChange={setOpen} />
      )}
      {!isMedia && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="h-[min(86vh,900px)] w-[min(1100px,calc(100vw-40px))] max-w-none">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5 pr-12">
              <Glyph kind={file.kind} className="text-muted-foreground" />
              <span className="truncate text-sm font-semibold">{file.name}</span>
              <Badge variant="secondary">{file.ext.toUpperCase()}</Badge>
              <a
                href={url}
                download={file.name}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Download className="size-3" />
                下载
              </a>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-2">
              <FileBody file={file} url={url} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function FileBody({ file, url }: { file: FileRef; url: string }) {
  if (file.kind === 'docx') return <DocxViewer url={url} />
  if (file.kind === 'xlsx') return <XlsxViewer url={url} />
  if (file.kind === 'pptx') return <PptxViewer url={url} />
  if (file.kind === 'pdf') {
    return (
      <iframe
        src={url}
        title={file.name}
        className="h-full min-h-[60vh] w-full rounded-lg border border-border bg-card"
      />
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-muted/20 text-sm text-muted-foreground">
      <Glyph kind={file.kind} className="size-10 text-muted-foreground/60" />
      <div>这个格式暂不支持内嵌预览</div>
      <a
        href={url}
        download={file.name}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground"
      >
        <Download className="size-3.5" />
        下载文件
      </a>
    </div>
  )
}

function MediaDialog({
  file,
  url,
  open,
  onOpenChange,
}: {
  file: FileRef
  url: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [zoom, setZoom] = React.useState(1)
  React.useEffect(() => {
    if (open) setZoom(1)
  }, [open, file.path])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(88vh,920px)] w-[min(1200px,calc(100vw-40px))] max-w-none">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5 pr-12">
          <Glyph kind={file.kind} className="text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{file.name}</span>
          <Badge variant="secondary">{file.ext.toUpperCase()}</Badge>
          <div className="ml-auto flex items-center gap-1">
            {file.kind === 'image' && (
              <>
                <Button type="button" variant="ghost" size="icon-sm" title="缩小" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
                  <ZoomOut className="size-3.5" />
                </Button>
                <span className="w-10 text-center font-mono text-[10.5px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
                <Button type="button" variant="ghost" size="icon-sm" title="放大" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
                  <ZoomIn className="size-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" title="重置" onClick={() => setZoom(1)}>
                  <RotateCcw className="size-3.5" />
                </Button>
              </>
            )}
            <a
              href={url}
              download={file.name}
              className="ml-1 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Download className="size-3" />
              下载
            </a>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#f6f7f9] p-3">
          {file.kind === 'image' && (
            <img
              src={url}
              alt={file.name}
              style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
              className="mx-auto block rounded-lg border border-border bg-card object-contain"
            />
          )}
          {file.kind === 'video' && (
            <video src={url} controls autoPlay={false} className="mx-auto block max-h-full w-full rounded-lg bg-black" />
          )}
          {file.kind === 'audio' && (
            <div className="flex h-full items-center justify-center">
              <audio src={url} controls className="w-full max-w-xl" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
