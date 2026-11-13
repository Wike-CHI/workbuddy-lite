import { useEffect, useState } from 'react'

type Workbook = any

export function XlsxViewer({ url }: { url: string }) {
  const [workbook, setWorkbook] = useState<Workbook>(null)
  const [sheets, setSheets] = useState<string[]>([])
  const [active, setActive] = useState('')
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [xlsx, setXlsx] = useState<any>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`读取文件失败（${res.status}）`)
        const buffer = await res.arrayBuffer()
        const lib = await import('xlsx')
        if (cancelled) return
        const wb = lib.read(buffer, { type: 'array' })
        setXlsx(lib)
        setWorkbook(wb)
        setSheets(wb.SheetNames || [])
        setActive(wb.SheetNames?.[0] || '')
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setLoading(false)
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url])

  useEffect(() => {
    if (!workbook || !xlsx || !active) return
    const sheet = workbook.Sheets?.[active]
    if (!sheet) return
    try {
      setHtml(xlsx.utils.sheet_to_html(sheet, { editable: false }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [workbook, active, xlsx])

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      {loading && <div className="py-10 text-center text-xs text-muted-foreground">正在解析 Excel 工作簿…</div>}
      {error && <div className="m-3 rounded-lg border border-[#f3d0d0] bg-[#fdf4f4] p-3 text-xs text-[#8f2d2d]">{error}</div>}
      {!loading && !error && (
        <>
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/30 px-2 py-1.5">
            {sheets.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setActive(name)}
                className={`shrink-0 rounded-md px-2 py-1 text-[11px] ${
                  name === active ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="xlsx-viewer" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </>
      )}
    </div>
  )
}
