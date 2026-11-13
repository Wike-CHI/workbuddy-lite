import { useEffect, useRef, useState } from 'react'

export function DocxViewer({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`读取文件失败（${res.status}）`)
        const buffer = await res.arrayBuffer()
        const docx = await import('docx-preview')
        if (!host.current || cancelled) return
        host.current.innerHTML = ''
        await docx.renderAsync(buffer, host.current, host.current, {
          className: 'docx',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          useBase64URL: true,
          renderHeaders: true,
          renderFooters: true,
        })
        if (!cancelled) setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setLoading(false)
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
      if (host.current) host.current.innerHTML = ''
    }
  }, [url])

  return (
    <div className="relative h-full overflow-auto rounded-xl bg-[#eef0f3] p-4">
      {loading && <div className="py-10 text-center text-xs text-muted-foreground">正在解析 Word 文档…</div>}
      {error && <div className="rounded-lg border border-[#f3d0d0] bg-[#fdf4f4] p-3 text-xs text-[#8f2d2d]">{error}</div>}
      <div ref={host} className="docx-host" />
    </div>
  )
}
