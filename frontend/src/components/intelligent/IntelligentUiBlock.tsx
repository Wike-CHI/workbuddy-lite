import * as React from 'react'

import type { WidgetKind, WidgetSpec } from '@/lib/types'
import { IntelligentUiWidget } from './IntelligentUiWidget'

const KINDS: WidgetKind[] = ['chart', 'map', 'form', 'article']

function normalize(parsed: any): WidgetSpec | null {
  if (!parsed || typeof parsed !== 'object') return null
  if (KINDS.includes(parsed.type)) return parsed as WidgetSpec
  if (parsed.type === 'intelligent-ui' || parsed.type === 'intelligent_ui') {
    const inner = parsed.widget || parsed.ui || parsed.spec || parsed.data
    if (inner && KINDS.includes(inner.type)) return inner as WidgetSpec
  }
  return null
}

export function IntelligentUiBlock({ code }: { code: string; language?: string }) {
  const parsed = React.useMemo(() => {
    try {
      return normalize(JSON.parse(code))
    } catch {
      return null
    }
  }, [code])

  if (!parsed) {
    const text = code.trim()
    const incomplete = text.length > 0 && (!text.endsWith('}') || text.length < 20)
    if (incomplete) {
      return (
        <div className="my-2 flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-[11.5px] text-muted-foreground">
          <span className="size-3 animate-spin rounded-full border-2 border-border border-t-primary" />
          正在生成交互回答…
        </div>
      )
    }
    return (
      <div className="my-2 overflow-hidden rounded-xl border border-[#f3d0d0] bg-[#fdf4f4]">
        <div className="border-b border-[#f3d0d0] px-3 py-1.5 text-[11px] font-medium text-[#8f2d2d]">
          交互回答 JSON 解析失败（需要 type: chart / map / form / article）
        </div>
        <pre className="max-h-52 overflow-auto p-3 font-mono text-[11px] leading-5 text-[#8f2d2d]">{code}</pre>
      </div>
    )
  }

  return <IntelligentUiWidget spec={parsed} />
}
