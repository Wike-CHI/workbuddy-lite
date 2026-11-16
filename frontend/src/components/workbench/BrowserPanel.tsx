import { ArrowLeft, ArrowRight, ExternalLink, Loader2, RotateCw } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { postBrowser, useWorkbenchStore } from '@/store/workbench'

function normalizeUrl(raw: string) {
  const value = raw.trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  if (/^localhost(:\d+)?/i.test(value) || /^127\.0\.0\.1/i.test(value)) return 'http://' + value
  return 'https://' + value
}

export function BrowserPanel() {
  const url = useWorkbenchStore((s) => s.browserUrl)
  const setUrl = useWorkbenchStore((s) => s.setBrowserUrl)
  const info = useWorkbenchStore((s) => s.browserInfo)
  const setInfo = useWorkbenchStore((s) => s.setBrowserInfo)
  const width = useWorkbenchStore((s) => s.width)
  const open = useWorkbenchStore((s) => s.open)

  const hostRef = React.useRef<HTMLDivElement>(null)
  const [draft, setDraft] = React.useState(url)
  const [address, setAddress] = React.useState(url)

  React.useEffect(() => setDraft(address), [address])

  // 把占位区域的位置告诉宿主，第二个 WebView2 会铺在上面
  React.useEffect(() => {
    const element = hostRef.current
    if (!element || !open) return
    const report = (action: 'show' | 'bounds') => {
      const rect = element.getBoundingClientRect()
      if (rect.width < 20 || rect.height < 20) return
      postBrowser({
        action,
        url: address,
        bounds: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
        dpr: window.devicePixelRatio || 1,
      })
    }
    report('show')
    const observer = new ResizeObserver(() => report('bounds'))
    observer.observe(element)
    const onResize = () => report('bounds')
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      postBrowser({ action: 'hide' })
    }
  }, [address, open, width])

  React.useEffect(() => {
    const host = (window as unknown as { chrome?: { webview?: any } }).chrome?.webview
    if (!host) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'browser-state') return
      setInfo({
        url: data.url,
        title: data.title,
        loading: data.loading,
        canGoBack: data.canGoBack,
        canGoForward: data.canGoForward,
      })
      if (typeof data.url === 'string' && data.url && data.url !== address) setAddress(data.url)
    }
    host.addEventListener('message', onMessage)
    return () => host.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  const go = () => {
    const next = normalizeUrl(draft)
    if (!next) return
    setAddress(next)
    setUrl(next)
    postBrowser({ action: 'navigate', url: next })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="后退"
          onClick={() => postBrowser({ action: 'back' })}
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <button
          type="button"
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="前进"
          onClick={() => postBrowser({ action: 'forward' })}
        >
          <ArrowRight className="size-3.5" />
        </button>
        <button
          type="button"
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="刷新"
          onClick={() => postBrowser({ action: 'reload' })}
        >
          {info?.loading ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
        </button>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              go()
            }
          }}
          placeholder="localhost:5173 或 https://…"
          className="h-7 flex-1 font-mono text-[11px]"
        />
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10.5px]" onClick={go}>
          打开
        </Button>
        <button
          type="button"
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="用系统浏览器打开"
          onClick={() => {
            const next = normalizeUrl(draft)
            if (next) window.open(next, '_blank', 'noopener')
          }}
        >
          <ExternalLink className="size-3.5" />
        </button>
      </div>

      {/* 这块区域由宿主用第二个 WebView2 覆盖 */}
      <div ref={hostRef} className="relative min-h-0 flex-1 bg-white">
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-[11px] leading-5 text-muted-foreground">
          输入本地开发地址（例如 localhost:5173）后，这里会加载一个独立的 WebView2。
        </div>
      </div>
    </div>
  )
}
