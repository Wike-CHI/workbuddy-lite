import type { TextMessagePartProps } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import * as React from 'react'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { CodeHeader } from './CodeHeader'
import { MermaidDiagram } from './MermaidDiagram'
import { IntelligentUiBlock } from '@/components/intelligent/IntelligentUiBlock'

function SafeCodeHeader({ language, code }: { language?: string; code: string }) {
  if (language === 'iui' || language === 'intelligent-ui') return null
  return <CodeHeader language={language} code={code} />
}

type Plugin = (...args: any[]) => any

const HAS_MATH = /\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\(|\\\[/

function hasMath(text: string) {
  return HAS_MATH.test(text)
}

function hasCode(text: string) {
  return /```/.test(text)
}

function pickPlugin(mod: unknown): Plugin | null {
  if (!mod) return null
  const candidate = (mod as { default?: unknown }).default ?? mod
  return typeof candidate === 'function' ? (candidate as Plugin) : null
}

export function MarkdownPart({ text }: TextMessagePartProps) {
  const needsMath = React.useMemo(() => hasMath(text || ''), [text])
  const needsCode = React.useMemo(() => hasCode(text || ''), [text])
  const [katex, setKatex] = React.useState<Plugin | null>(null)
  const [highlight, setHighlight] = React.useState<Plugin | null>(null)

  // KaTeX 的 JS/CSS 只在消息里真的出现公式时才加载
  React.useEffect(() => {
    if (!needsMath || katex) return
    let cancelled = false
    void import('katex/dist/katex.min.css')
    import('rehype-katex')
      .then((mod) => {
        if (!cancelled) setKatex(() => pickPlugin(mod))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [needsMath, katex])

  // highlight.js 同理：只有出现 ``` 代码块才拉
  React.useEffect(() => {
    if (!needsCode || highlight) return
    let cancelled = false
    import('rehype-highlight')
      .then((mod) => {
        if (!cancelled) setHighlight(() => pickPlugin(mod))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [needsCode, highlight])

  const rehypePlugins: any[] = []
  if (katex) rehypePlugins.push([katex, { throwOnError: false }])
  if (highlight) rehypePlugins.push([highlight, { detect: true, ignoreMissing: true }])

  return (
    <MarkdownTextPrimitive
      className="chat-prose aui-md"
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={rehypePlugins}
      components={{ CodeHeader: SafeCodeHeader }}
      componentsByLanguage={{
        mermaid: { SyntaxHighlighter: MermaidDiagram },
        iui: { SyntaxHighlighter: IntelligentUiBlock },
        'intelligent-ui': { SyntaxHighlighter: IntelligentUiBlock },
      }}
      smooth={false}
    />
  )
}
