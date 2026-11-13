import * as React from 'react'

import { buildChartOption } from '@/lib/widgetOptions'
import type { VisualTheme, WidgetSpec } from '@/lib/types'
import type { WidgetHandle } from './handle'

export const ChartWidget = React.forwardRef<WidgetHandle, { spec: WidgetSpec; theme: VisualTheme }>(
  function ChartWidget({ spec, theme }, ref) {
    const host = React.useRef<HTMLDivElement>(null)
    const chart = React.useRef<any>(null)

    React.useEffect(() => {
      if (!spec.chart || !host.current) return
      let disposed = false
      let observer: ResizeObserver | null = null
      ;(async () => {
        const mod = await import('echarts')
        const echarts = (mod as any).default ?? mod
        if (disposed || !host.current) return
        chart.current = echarts.init(host.current)
        chart.current.setOption(buildChartOption(spec.chart!, theme))
        observer = new ResizeObserver(() => chart.current?.resize())
        observer.observe(host.current)
      })()
      return () => {
        disposed = true
        observer?.disconnect()
        chart.current?.dispose()
        chart.current = null
      }
    }, [spec.chart, theme])

    React.useImperativeHandle(
      ref,
      () => ({
        exportImage: () =>
          chart.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: theme.background }) || null,
      }),
      [theme.background],
    )

    if (!spec.chart) {
      return <div className="rounded-xl border border-[#f3d0d0] bg-[#fdf4f4] p-3 text-xs text-[#8f2d2d]">缺少 chart 配置</div>
    }

    return <div ref={host} className="h-[380px] w-full" />
  },
)
