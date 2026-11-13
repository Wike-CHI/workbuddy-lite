import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { VisualTheme, WidgetSpec } from '@/lib/types'
import type { WidgetHandle } from './handle'

export const ArticleWidget = React.forwardRef<WidgetHandle, { spec: WidgetSpec; theme: VisualTheme }>(
  function ArticleWidget({ spec, theme }, ref) {
    const article = spec.article
    const host = React.useRef<HTMLDivElement>(null)

    React.useImperativeHandle(
      ref,
      () => ({
        exportImage: async () => {
          if (!host.current) return null
          const { toPng } = await import('html-to-image')
          return toPng(host.current, { pixelRatio: 2, backgroundColor: theme.background, cacheBust: true })
        },
      }),
      [theme.background],
    )

    if (!article?.markdown) {
      return <div className="rounded-xl border border-[#f3d0d0] bg-[#fdf4f4] p-3 text-xs text-[#8f2d2d]">缺少 article.markdown</div>
    }

    return (
      <div
        ref={host}
        className="space-y-3"
        style={{ fontFamily: theme.fontFamily, color: theme.foreground, background: theme.background }}
      >
        {article.cover && (
          <img
            src={article.cover}
            alt=""
            className="max-h-72 w-full rounded-xl border object-cover"
            style={{ borderColor: theme.muted }}
          />
        )}
        {(article.tags?.length || article.author) && (
          <div className="flex flex-wrap items-center gap-2">
            {article.tags?.map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2.5 py-0.5 text-[10.5px]"
                style={{ background: theme.muted, color: theme.foreground }}
              >
                {tag}
              </span>
            ))}
            {article.author && <span className="text-[10.5px] text-muted-foreground">{article.author}</span>}
          </div>
        )}
        <div className="chat-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{article.markdown}</ReactMarkdown>
        </div>
      </div>
    )
  },
)
