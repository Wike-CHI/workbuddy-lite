import type { ModelInfo } from './types'

export function fmtNum(n: number | undefined | null) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1) + 'M'
  if (v >= 1000) return (v / 1000).toFixed(v >= 10_000 ? 0 : 1) + 'k'
  return String(v)
}

export function fmtCredits(n: number | undefined | null) {
  const v = Number(n || 0)
  if (!v) return '0'
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1).replace(/\.0$/, '')
  return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function multiplierOf(m: ModelInfo | undefined | null) {
  if (!m) return null
  const hit = String(m.credits || '').match(/[x×]\s*([\d.]+)/i)
  if (hit) return parseFloat(hit[1])
  if (typeof m.multiplier === 'number') return m.multiplier
  return null
}

export function modelShort(m: ModelInfo | undefined | null) {
  if (!m) return ''
  const v = multiplierOf(m)
  if (v === null) return m.name || m.id
  return `${m.name || m.id} · ${v === 0 ? '免费' : '×' + v}`
}

export function fmtReset(ms: number | undefined) {
  if (!ms) return '—'
  const d = new Date(Number(ms))
  if (Number.isNaN(d.getTime())) return '—'
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function relTime(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前'
  return Math.floor(diff / 86_400_000) + ' 天前'
}

export function leafOf(path: string) {
  const p = String(path || '').replace(/[\\/]+$/, '')
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(i + 1) : p
}

export function fmtTime(ts: number) {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export function truncate(text: string, max = 24) {
  const chars = [...String(text || '').replace(/\s+/g, ' ').trim()]
  return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('')
}
