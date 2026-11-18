import { Loader2 } from 'lucide-react'
import * as React from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { modelShort } from '@/lib/format'
import { useChatStore } from '@/store/chat'
import { useTeamStore } from '@/store/team'

const MAX_NAME = 60
const MAX_DESCRIPTION = 2000
const INHERIT = '__inherit__'

// 每次打开都重新挂载表单，草稿状态天然重置，不需要在 effect 里 setState。
export function NewAgentDialog() {
  const open = useTeamStore((s) => s.createAgentOpen)
  return open ? <NewAgentForm /> : null
}

// 新建智能体：name 必填，title/description 是人设素材，model 留空则继承频道/服务端默认。
// 创建成功后可以直接加入当前频道（复用成员全量替换，不额外起第二个请求）。
function NewAgentForm() {
  const creating = useTeamStore((s) => s.creatingAgent)
  const canManage = useTeamStore((s) => s.canManage)
  const channels = useTeamStore((s) => s.channels)
  const activeChannelId = useTeamStore((s) => s.activeChannelId)
  const channelMaxMembers = useTeamStore((s) => s.channelMaxMembers)
  const closeCreateAgent = useTeamStore((s) => s.closeCreateAgent)
  const createAgent = useTeamStore((s) => s.createAgent)
  const models = useChatStore((s) => s.models)

  const channel = channels.find((item) => item.id === activeChannelId)
  const room = channel ? channelMaxMembers - channel.memberAgentIds.length : 0
  const canJoin = !!channel && room > 0

  const [name, setName] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [model, setModel] = React.useState('')
  // 频道已满时默认不勾选，避免创建完才发现加不进去
  const [joinChannel, setJoinChannel] = React.useState(canJoin)
  const [error, setError] = React.useState('')

  const submit = async () => {
    if (creating) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请填写智能体名字')
      return
    }
    setError('')
    const result = await createAgent({
      name: trimmed,
      title,
      description,
      model,
      joinChannel: joinChannel && canJoin,
    })
    if (!result.ok) setError(result.error || '新建失败')
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : closeCreateAgent())}>
      <DialogContent id="new-agent-dialog" className="w-[min(580px,calc(100vw-64px))]">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-4">
          <DialogTitle>新建智能体</DialogTitle>
          <DialogDescription>
            会加进 AI 同事名册；写清角色与人设，之后在频道里 @ 它就能按这个设定干活。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-agent-name" className="text-[11.5px] font-medium text-ink-2">
                名字
              </label>
              <Input
                id="new-agent-name"
                value={name}
                autoFocus
                maxLength={MAX_NAME}
                placeholder="例如：发布值守"
                onChange={(event) => {
                  setName(event.target.value)
                  setError('')
                }}
                className="mt-1.5 h-8 text-[13px]"
              />
            </div>
            <div>
              <label htmlFor="new-agent-title" className="text-[11.5px] font-medium text-ink-2">
                角色（一行，可选）
              </label>
              <Input
                id="new-agent-title"
                value={title}
                maxLength={MAX_NAME}
                placeholder="例如：发布与回滚"
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1.5 h-8 text-[13px]"
              />
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-baseline gap-2">
              <label
                htmlFor="new-agent-description"
                className="text-[11.5px] font-medium text-ink-2"
              >
                人设 / 内部提示词（可选）
              </label>
              <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                {description.length}/{MAX_DESCRIPTION}
              </span>
            </div>
            <Textarea
              id="new-agent-description"
              value={description}
              maxLength={MAX_DESCRIPTION}
              rows={6}
              placeholder="职责、边界、输出要求。例如：你负责发布窗口内的切换与回滚，先给检查清单再执行。"
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1.5 min-h-[132px] resize-y text-[13px] leading-[1.7]"
            />
            <div className="mt-1.5 text-[10.5px] leading-4 text-ink-4">
              这段文字会作为该 bot 的系统提示词素材；之后可以在成员面板里随时改。
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="new-agent-model" className="text-[11.5px] font-medium text-ink-2">
              模型
            </label>
            <Select
              value={model || INHERIT}
              onValueChange={(value) => setModel(value === INHERIT ? '' : value)}
            >
              <SelectTrigger id="new-agent-model" className="mt-1.5 h-8 text-[12.5px]">
                <SelectValue placeholder="继承频道默认" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>继承频道默认</SelectItem>
                {models.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {modelShort(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label
            htmlFor="new-agent-join"
            className="mt-4 flex items-start gap-2 rounded-lg border border-border/70 px-3 py-2.5"
          >
            <input
              id="new-agent-join"
              type="checkbox"
              checked={joinChannel && canJoin}
              disabled={!canJoin}
              onChange={(event) => setJoinChannel(event.target.checked)}
              className="mt-0.5 size-3.5 accent-[var(--primary)]"
            />
            <span className="min-w-0">
              <span className="block text-[12px] text-ink">
                {channel ? `创建后加入「${channel.name}」` : '创建后不加入频道'}
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-4 text-ink-4">
                {!channel
                  ? '当前没有打开的频道；创建后可在侧栏进入频道再添加。'
                  : canJoin
                    ? `频道还有 ${room} 个空位，确认后会直接加入。`
                    : '频道已满，创建后只进入名册。'}
              </span>
            </span>
          </label>

          {error && (
            <div id="new-agent-error" className="mt-3 text-[11px] leading-4 text-err">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-4">
            {canManage ? '名字不能与名册里已有的智能体重名' : '当前后端不支持新建智能体'}
          </span>
          <button
            type="button"
            onClick={closeCreateAgent}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] text-ink-2 transition-colors hover:bg-surface-2"
          >
            取消
          </button>
          <button
            type="button"
            id="new-agent-submit"
            disabled={!canManage || creating || !name.trim()}
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
