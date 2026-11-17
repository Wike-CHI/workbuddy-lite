import { cn } from '@/lib/utils'

// CLI 用 avatarVariant 选素材；壳没有素材，用「首字 + 稳定色」代替。
// 颜色只取现有 token 的 soft 组合，不写 hex。
const PALETTE = [
  'bg-accent-soft text-accent-ink',
  'bg-surface-3 text-ink-2',
  'bg-surface-2 text-accent-ink',
  'bg-surface-3 text-accent-ink',
  'bg-accent-soft text-ink-2',
  'bg-surface-2 text-ink-2',
]

function hashOf(value: string) {
  let hash = 0
  for (const char of value) hash = (hash * 31 + (char.codePointAt(0) || 0)) >>> 0
  return hash
}

export function BotAvatar({
  agentId,
  name,
  presence,
  size = 22,
  surface = 'main',
  className,
}: {
  agentId: string
  name: string
  presence?: string
  size?: number
  surface?: 'main' | 'sidebar'
  className?: string
}) {
  const palette = PALETTE[hashOf(agentId) % PALETTE.length]
  const first = Array.from(name || '?')[0] || '?'
  const online = presence === 'active' || presence === 'online'
  const statusClass = online ? 'bg-ok' : 'bg-ink-4'
  const statusText = presence ? (online ? '在线' : '离线') : '状态未知'
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full', palette, className)}
      style={{ width: size, height: size }}
      title={`${name} · ${statusText}`}
      aria-hidden
    >
      <span style={{ fontSize: Math.max(9, Math.round(size * 0.46)) }} className="font-medium leading-none">
        {first}
      </span>
      <span
        className={cn(
          'absolute -bottom-px -right-px rounded-full ring-2',
          statusClass,
          surface === 'sidebar' ? 'ring-sidebar' : 'ring-background',
        )}
        style={{ width: 6, height: 6 }}
      />
    </span>
  )
}
