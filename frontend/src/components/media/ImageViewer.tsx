import { Download, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function ImageViewer({
  src,
  alt,
  className,
  imageClassName,
}: {
  src: string
  alt?: string
  className?: string
  imageClassName?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)

  React.useEffect(() => {
    if (open) setZoom(1)
  }, [open, src])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('group relative block max-w-full overflow-hidden rounded-xl border border-border', className)}
        title="查看大图"
      >
        <img src={src} alt={alt || '图片'} loading="lazy" className={cn('block object-cover', imageClassName)} />
        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
          查看大图
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[min(88vh,920px)] w-[min(1200px,calc(100vw-40px))] max-w-none">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5 pr-12">
            <span className="truncate text-sm font-semibold">{alt || '图片'}</span>
            <div className="ml-auto flex items-center gap-1">
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
              <a
                href={src}
                download={alt || 'image'}
                className="ml-1 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Download className="size-3" />
                下载
              </a>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-[#f6f7f9] p-3">
            <img
              src={src}
              alt={alt || '图片'}
              style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
              className="mx-auto block rounded-lg border border-border bg-card object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
