import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

export function CodeHeader({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard may be unavailable
    }
  }
  return (
    <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-[10.5px] text-muted-foreground">
      <span className="font-mono uppercase tracking-wide">{language || 'text'}</span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}
