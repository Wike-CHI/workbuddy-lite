// Composer 与 ChannelComposer 共用的 palette 解析、过滤与键盘步进规则。
// 放在独立文件里，避免从组件文件导出非组件（HMR 也不稳定）。

export type PaletteMode = 'skill' | 'connector' | 'member'

export interface PaletteState {
  mode: PaletteMode
  query: string
  start: number
  end: number
  index: number
}

export function detectPalette(value: string, cursor: number): PaletteState | null {
  const before = value.slice(0, cursor)
  const match = before.match(/(^|[\s\u3000])([/@])([^\s/@]*)$/)
  if (!match) return null
  return {
    mode: match[2] === '/' ? 'skill' : 'connector',
    query: match[3],
    start: cursor - match[2].length - match[3].length,
    end: cursor,
    index: 0,
  }
}

// ↑↓ / Enter / Esc 的规则由两个 composer 共用，避免手感不一致
export function paletteStep(
  key: string,
  index: number,
  count: number,
): number | 'pick' | 'close' | null {
  if (key === 'Escape') return 'close'
  if (!count) return key === 'Enter' || key === 'Tab' ? 'close' : null
  if (key === 'ArrowDown') return (index + 1) % count
  if (key === 'ArrowUp') return (index - 1 + count) % count
  if (key === 'Enter' || key === 'Tab') return 'pick'
  return null
}

export function filterItems<T extends { name: string; description?: string }>(items: T[], query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items
    .filter((item) => `${item.name} ${item.description || ''}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1
      return ap - bp || a.name.localeCompare(b.name)
    })
}
