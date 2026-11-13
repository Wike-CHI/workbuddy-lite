import { useEffect, useRef, useState } from 'react'

export function PptxViewer({ url }: { url: string }) {
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
        const { init } = await import('pptx-preview')
        if (!host.current || cancelled) return
        host.current.innerHTML = ''
        const width = Math.min(960, Math.max(640, host.current.clientWidth - 32 || 960))
        const viewer = init(host.current, { width, height: Math.round((width * 9) / 16) })
        await Promise.resolve(viewer.preview(buffer))
        if (!cancelled) {
          // 少数复杂 PPT 会生成空壳（只有黑底 wrapper），给个明确降级提示
          let rendered = false
          for (let attempt = 0; attempt < 10; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 200))
            const wrapper = host.current?.querySelector('.pptx-preview-wrapper')
            if (wrapper && wrapper.childElementCount > 0) {
              rendered = true
              break
            }
          }
          if (!rendered) throw new Error('这个 PPT 暂不支持内嵌预览，请下载原文件')
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          if (host.current) host.current.innerHTML = ''
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
      {loading && <div className="py-10 text-center text-xs text-muted-foreground">正在渲染 PPT 幻灯片…</div>}
      {error && <div className="rounded-lg border border-[#f3d0d0] bg-[#fdf4f4] p-3 text-xs text-[#8f2d2d]">{error}</div>}
      <div ref={host} className="pptx-preview-host mx-auto" />
    </div>
  )
}
