import * as React from 'react'

import { buildMapOption } from '@/lib/widgetOptions'
import { getWorldGeoJson, resolveGeoJson } from '@/lib/worldMap'
import type { VisualTheme, WidgetSpec } from '@/lib/types'
import type { WidgetHandle } from './handle'

export const MapWidget = React.forwardRef<WidgetHandle, { spec: WidgetSpec; theme: VisualTheme }>(
  function MapWidget({ spec, theme }, ref) {
    const host = React.useRef<HTMLDivElement>(null)
    const chart = React.useRef<any>(null)
    const [error, setError] = React.useState<string | null>(null)

    React.useEffect(() => {
      if (!spec.map || !host.current) return
      let disposed = false
      let observer: ResizeObserver | null = null
      setError(null)
      ;(async () => {
        try {
          const custom = spec.map?.geojson ? await resolveGeoJson(spec.map.geojson) : null
          const [mod, geo] = await Promise.all([import('echarts'), custom ? Promise.resolve(custom) : getWorldGeoJson()])
          const echarts = (mod as any).default ?? mod
          if (disposed || !host.current) return
          const mapName = custom ? 'iui-custom' : 'world'
          echarts.registerMap(mapName, geo)
          chart.current = echarts.init(host.current)
          chart.current.setOption(buildMapOption(spec.map!, theme, mapName))
          observer = new ResizeObserver(() => chart.current?.resize())
          observer.observe(host.current)
        } catch (err) {
          if (!disposed) setError(err instanceof Error ? err.message : String(err))
        }
      })()
      return () => {
        disposed = true
        observer?.disconnect()
        chart.current?.dispose()
        chart.current = null
      }
    }, [spec.map, theme])

    React.useImperativeHandle(
      ref,
      () => ({
        exportImage: () =>
          chart.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: theme.background }) || null,
      }),
      [theme.background],
    )

    if (!spec.map) {
      return <div className="rounded-xl border border-[#f3d0d0] bg-[#fdf4f4] p-3 text-xs text-[#8f2d2d]">缺少 map 配置</div>
    }

    if (error) {
      return (
        <div className="rounded-xl border border-[#f3d0d0] bg-[#fdf4f4] p-3 text-xs text-[#8f2d2d]">
          地图加载失败：{error}
        </div>
      )
    }

    return <div ref={host} className="h-[420px] w-full" />
  },
)
