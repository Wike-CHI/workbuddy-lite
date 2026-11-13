import type { DataMessagePartProps } from '@assistant-ui/react'

export function UserMetaPart({ data }: DataMessagePartProps<{ connectors?: string[] }>) {
  const connectors = data?.connectors || []
  if (!connectors.length) return null
  return <div className="text-[10.5px] text-muted-foreground">连接器：{connectors.join(' · ')}</div>
}
