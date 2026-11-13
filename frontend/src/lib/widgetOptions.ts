import type { ChartSpec, MapSpec, VisualTheme } from './types'

function escHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function axisStyle(theme: VisualTheme) {
  return {
    axisLine: { lineStyle: { color: theme.muted } },
    axisTick: { show: false },
    axisLabel: { color: theme.foreground, fontSize: 11 },
    splitLine: { lineStyle: { color: theme.muted, type: 'dashed' } },
  }
}

export function buildChartOption(chart: ChartSpec, theme: VisualTheme): any {
  const textStyle = { fontFamily: theme.fontFamily, color: theme.foreground }
  const tooltip = {
    trigger: chart.kind === 'pie' ? 'item' : 'axis',
    backgroundColor: theme.background,
    borderColor: theme.muted,
    textStyle: { color: theme.foreground, fontSize: 12 },
    valueFormatter: (value: number) => `${value}${chart.unit || ''}`,
  }

  if (chart.kind === 'pie') {
    const data = chart.data?.length
      ? chart.data
      : (chart.categories || []).map((name, index) => ({
          name,
          value: chart.series?.[0]?.data?.[index] || 0,
        }))
    return {
      backgroundColor: 'transparent',
      color: theme.palette,
      textStyle,
      tooltip,
      legend: {
        show: chart.showLegend !== false,
        bottom: 0,
        textStyle: { color: theme.foreground, fontSize: 11 },
        icon: 'circle',
      },
      series: [
        {
          type: 'pie',
          radius: ['38%', '68%'],
          center: ['50%', '46%'],
          itemStyle: { borderColor: theme.background, borderWidth: 2, borderRadius: 6 },
          label: { color: theme.foreground, fontSize: 11, formatter: '{b}\n{d}%' },
          data,
        },
      ],
    }
  }

  const categories =
    chart.categories?.length
      ? chart.categories
      : chart.data?.map((d) => d.name) || []
  const series = (chart.series?.length
    ? chart.series
    : [{ name: chart.yLabel || '数值', data: chart.data?.map((d) => d.value) || [] }]
  ).map((item, index) => {
    const type = chart.kind === 'area' ? 'line' : chart.kind
    return {
      name: item.name || `系列 ${index + 1}`,
      type,
      data: item.data,
      smooth: type === 'line',
      symbol: 'circle',
      symbolSize: type === 'line' ? 6 : undefined,
      showSymbol: type === 'line',
      barMaxWidth: 36,
      itemStyle: { borderRadius: type === 'bar' ? [5, 5, 0, 0] : 0 },
      areaStyle:
        chart.kind === 'area'
          ? {
              opacity: 0.18,
              color: theme.palette[index % theme.palette.length],
            }
          : undefined,
      label: chart.showValues
        ? {
            show: true,
            position: type === 'bar' ? 'top' : 'top',
            color: theme.foreground,
            fontSize: 10,
            formatter: (params: any) => `${params.value}${chart.unit || ''}`,
          }
        : undefined,
    }
  })

  return {
    backgroundColor: 'transparent',
    color: theme.palette,
    textStyle,
    tooltip,
    legend: {
      show: chart.showLegend !== false && series.length > 1,
      bottom: 0,
      textStyle: { color: theme.foreground, fontSize: 11 },
      icon: 'circle',
    },
    grid: { left: 16, right: 18, top: 24, bottom: series.length > 1 ? 42 : 28, containLabel: true },
    xAxis: {
      type: 'category',
      data: categories,
      name: chart.xLabel,
      nameTextStyle: { color: theme.foreground, fontSize: 10 },
      ...axisStyle(theme),
      axisLabel: { ...axisStyle(theme).axisLabel, rotate: categories.length > 8 ? 30 : 0 },
    },
    yAxis: {
      type: 'value',
      name: chart.yLabel,
      nameTextStyle: { color: theme.foreground, fontSize: 10 },
      ...axisStyle(theme),
    },
    series,
  }
}

export function buildMapOption(map: MapSpec, theme: VisualTheme, mapName: string = 'world'): any {
  const markers = map.markers || []
  const maxValue = Math.max(1, ...markers.map((m) => Number(m.value || 1)))
  const isWorld = mapName === 'world'
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: theme.fontFamily, color: theme.foreground },
    tooltip: {
      trigger: 'item',
      backgroundColor: theme.background,
      borderColor: theme.muted,
      textStyle: { color: theme.foreground, fontSize: 12 },
      formatter: (params: any) => {
        const item = params.data || {}
        const lines = [`<b>${escHtml(item.name || params.name)}</b>`]
        if (item.description) lines.push(escHtml(item.description))
        if (item.value && Array.isArray(item.value) && item.value[2] !== undefined) {
          lines.push(`数值：${item.value[2]}`)
        }
        return lines.join('<br/>')
      },
    },
    geo: {
      map: mapName,
      roam: true,
      zoom: map.zoom ?? (isWorld ? 1.15 : 1),
      center: map.center ?? (isWorld ? [10, 25] : undefined),
      itemStyle: {
        areaColor: theme.muted,
        borderColor: isWorld ? theme.background : theme.foreground,
        borderWidth: isWorld ? 0.7 : 0.8,
      },
      emphasis: {
        itemStyle: { areaColor: theme.accent },
        label: { show: !isWorld, color: theme.background, fontSize: 10 },
      },
      label: {
        show: !isWorld,
        color: theme.foreground,
        fontSize: 10.5,
      },
      select: { disabled: true },
    },
    series: [
      {
        type: 'effectScatter',
        coordinateSystem: 'geo',
        data: markers.map((marker) => ({
          name: marker.name,
          value: [marker.lng, marker.lat, marker.value ?? 1],
          description: marker.description,
        })),
        symbolSize: (value: number[]) => {
          const ratio = Number(value[2] || 1) / maxValue
          if (!isWorld) return Math.max(5, Math.min(12, 5 + ratio * 7))
          const base = 8 + ratio * 14
          return Math.max(8, Math.min(26, base))
        },
        showEffectOn: 'render',
        rippleEffect: { brushType: 'stroke', scale: isWorld ? 3.2 : 2.4 },
        itemStyle: { color: theme.primary, shadowBlur: 8, shadowColor: theme.primary },
        label: {
          show: isWorld,
          position: 'right',
          formatter: '{b}',
          color: theme.foreground,
          fontSize: 10,
        },
        labelLayout: { hideOverlap: true },
        emphasis: { scale: 1.2 },
      },
    ],
  }
}
