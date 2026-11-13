import { useEffect, useId, useState } from 'react'

type MermaidModule = typeof import('mermaid')
let mermaidPromise: Promise<MermaidModule> | null = null
let mermaidReady = false

async function getMermaid() {
  if (!mermaidPromise) mermaidPromise = import('mermaid')
  const mod = await mermaidPromise
  if (!mermaidReady) {
    mod.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        background: '#ffffff',
        primaryColor: '#eaf1fe',
        primaryTextColor: '#16181d',
        primaryBorderColor: '#c3d4f7',
        lineColor: '#8a9099',
        secondaryColor: '#f4f5f7',
        tertiaryColor: '#fbfbfc',
        fontFamily: '-apple-system, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif',
      },
    })
    mermaidReady = true
  }
  return mod.default
}

type MermaidProps = {
  code: string
  language?: string
}

export function MermaidDiagram({ code }: MermaidProps) {
  const reactId = useId()
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const id = 'mermaid-' + reactId.replace(/[^a-zA-Z0-9_-]/g, '')
    getMermaid()
      .then((mermaid) => mermaid.render(id, code))
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg)
          setError('')
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSvg('')
          setError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
      document.getElementById('d' + id)?.remove()
    }
  }, [code, reactId])

  if (error) {
    return (
      <div className="rounded-xl border border-[#f3d0d0] bg-[#fdf4f4] p-3 text-xs text-[#8f2d2d]">
        Mermaid 渲染失败：{error}
      </div>
    )
  }

  if (!svg) {
    return <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">正在渲染图表…</div>
  }

  return (
    <div
      className="my-3 flex justify-center overflow-x-auto rounded-xl border border-border bg-card p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
