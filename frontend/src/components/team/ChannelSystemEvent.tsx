import { cn } from '@/lib/utils'

function clock(at?: number) {
  if (!at) return ''
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function ChannelSystemEvent({ text, at, className }: { text: string; at?: number; className?: string }) {
  return (
    <div className={cn('flex justify-center px-6 py-1', className)}>
      <span
        className="max-w-[min(84%,560px)] text-center text-[12px] leading-5 text-ink-3"
        title={at ? clock(at) : undefined}
      >
        {text}
      </span>
    </div>
  )
}
