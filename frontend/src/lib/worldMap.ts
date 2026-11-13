let cache: any = null

export async function getWorldGeoJson() {
  if (cache) return cache
  const [topoMod, topojson] = await Promise.all([
    import('world-atlas/countries-110m.json'),
    import('topojson-client'),
  ])
  const topo = (topoMod as any).default ?? topoMod
  const feature = (topojson as any).feature ?? (topojson as any).default?.feature
  if (typeof feature !== 'function') throw new Error('地图数据加载失败')
  cache = feature(topo, topo.objects.countries)
  return cache
}

/**
 * 解析自定义底图：支持 GeoJSON 对象、GeoJSON 字符串，或指向 GeoJSON 的地址/本地路径。
 * 无法解析时抛错，由调用方提示。
 */
export async function resolveGeoJson(source: unknown): Promise<any> {
  if (!source) return null
  if (typeof source === 'object') return source

  const text = String(source).trim()
  if (!text) return null
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('自定义地图数据不是合法 JSON')
    }
  }

  const res = await fetch(text)
  if (!res.ok) throw new Error(`加载自定义地图失败（HTTP ${res.status}）`)
  return res.json()
}
