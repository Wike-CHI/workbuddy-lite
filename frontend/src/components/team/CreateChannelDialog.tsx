import { Check, Loader2 } from 'lucide-react'
import * as React from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useTeamStore } from '@/store/team'

import { BotAvatar } from './BotAvatar'

// 建频道只做「名字 + 成员 + 可选组长」三件事，与 CLI 的 POST /channels 一一对应。
// 默认分身不在 agents[] 里（state 已过滤），所以这里不需要再判一次。
export function CreateChannelDialog() {
  const creating = useTeamStore((s) => s.creating)
  const agents = useTeamStore((s) => s.agents)
  const channels = useTeamStore((s) => s.channels)
  const presence = useTeamStore((s) => s.presence)
  const channelMaxMembers = useTeamStore((s) => s.channelMaxMembers)
  const closeCreate = useTeamStore((s) => s.closeCreate)
  const createChannel = useTeamStore((s) => s.createChannel)

  const [name, setName] = React.useState('')
  const [picked, setPicked] = React.useState<string[]>([])
  const [lead, setLead] = React.useState('')
  const [error, setError] = React.useState('')

  const trimmed = name.trim()
  const duplicate = !!trimmed && channels.some((item) => item.name.trim() === trimmed)
  const hint = !trimmed
    ? '先给频道起个名字'
    : picked.length < 2
      ? '至少选择两个智能体'
      : picked.length > channelMaxMembers
        ? `最多 ${channelMaxMembers} 个智能体`
        : duplicate
          ? '已有同名频道，换个名字'
          : `${picked.length} 个成员 · ${lead ? '设了组长' : '由你负责编排'}`
  const canSubmit = !creating && !duplicate && picked.length >= 2 && picked.length <= channelMaxMembers && !!trimmed

  const toggle = (agentId: string) => {
    setError('')
    setPicked((current) => {
      if (current.includes(agentId)) {
        if (lead === agentId) setLead('')
        return current.filter((id) => id !== agentId)
      }
      if (current.length >= channelMaxMembers) return current
      return [...current, agentId]
    })
  }

  const submit = async () => {
    if (!canSubmit) return
    setError('')
    const result = await createChannel({ name: trimmed, memberAgentIds: picked, leadAgentId: lead })
    if (!result.ok) setError(result.error || '创建失败')
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : closeCreate())}>
      <DialogContent id="create-channel-dialog" className="w-[min(560px,calc(100vw-64px))]">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-4">
          <DialogTitle>新建频道</DialogTitle>
          <DialogDescription>
            选至少两个智能体组成一个频道；发消息时只有被 @ 的成员会被唤醒。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label htmlFor="create-channel-name" className="text-[11.5px] font-medium text-ink-2">
            频道名
          </label>
          <Input
            id="create-channel-name"
            value={name}
            autoFocus
            maxLength={30}
            onChange={(event) => {
              setName(event.target.value)
              setError('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder="例如：发布值守"
            className="mt-1.5 h-8 text-[13px]"
          />

          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-[11.5px] font-medium text-ink-2">成员</span>
            <span id="create-channel-count" className="font-mono text-[10.5px] text-ink-4">
              {picked.length}/{channelMaxMembers}
            </span>
            <span className="ml-auto text-[10.5px] text-ink-4">至少 2 个</span>
          </div>

          <div className="mt-1.5 max-h-[248px] overflow-y-auto rounded-lg border border-border/70 p-1">
            {!agents.length && (
              <div className="px-2 py-6 text-center text-[11.5px] text-ink-4">
                名册里还没有智能体，先在 CodeBuddy 里创建 AI 同事
              </div>
            )}
            {agents.map((agent) => {
              const selected = picked.includes(agent.id)
              const atCap = !selected && picked.length >= channelMaxMembers
              return (
                <button
                  key={agent.id}
                  id={`create-channel-member-${agent.id}`}
                  type="button"
                  aria-pressed={selected}
                  disabled={atCap}
                  onClick={() => toggle(agent.id)}
                  title={atCap ? `最多 ${channelMaxMembers} 个智能体` : agent.title || agent.name}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                    selected ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                    atCap && 'cursor-not-allowed opacity-45',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                    )}
                  >
                    {selected && <Check className="size-3" />}
                  </span>
                  <BotAvatar agentId={agent.id} name={agent.name} presence={presence[agent.id]} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{agent.name}</span>
                    <span className="block truncate text-[10.5px] text-ink-4">
                      {[agent.title, agent.model].filter(Boolean).join(' · ') || '未填写角色'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-4 text-[11.5px] font-medium text-ink-2">组长（可选）</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button
              id="create-channel-lead-none"
              type="button"
              onClick={() => setLead('')}
              aria-pressed={!lead}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] transition-colors',
                !lead
                  ? 'border-primary/45 bg-primary/8 text-primary'
                  : 'border-border text-ink-3 hover:bg-surface-2',
              )}
            >
              不设组长（你负责编排）
            </button>
            {picked.map((id) => {
              const agent = agents.find((item) => item.id === id)
              if (!agent) return null
              const active = lead === id
              return (
                <button
                  key={id}
                  id={`create-channel-lead-${id}`}
                  type="button"
                  onClick={() => setLead(active ? '' : id)}
                  aria-pressed={active}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[11px] transition-colors',
                    active
                      ? 'border-primary/45 bg-primary/8 text-primary'
                      : 'border-border text-ink-3 hover:bg-surface-2',
                  )}
                >
                  {agent.name}
                </button>
              )
            })}
            {!picked.length && (
              <span className="py-1 text-[10.5px] text-ink-4">选中成员后可以指定组长</span>
            )}
          </div>

          {error && (
            <div id="create-channel-error" className="mt-3 text-[11px] text-err">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <span id="create-channel-hint" className="min-w-0 flex-1 truncate text-[10.5px] text-ink-4">
            {hint}
          </span>
          <button
            type="button"
            onClick={closeCreate}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] text-ink-2 transition-colors hover:bg-surface-2"
          >
            取消
          </button>
          <button
            id="create-channel-submit"
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="inline-flex min-w-16 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating && <Loader2 className="size-3.5 animate-spin" />}
            {creating ? '创建中…' : '创建'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
