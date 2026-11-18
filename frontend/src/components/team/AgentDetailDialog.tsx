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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useTeamStore } from '@/store/team'

import { BotAvatar } from './BotAvatar'

const MAX_DESCRIPTION = 2000
const MAX_NAME = 60

function permissionLabel(mode?: string) {
  if (!mode) return '未设置'
  const map: Record<string, string> = {
    fullAccess: '完全访问',
    default: '默认（按需询问）',
    acceptEdits: '自动接受编辑',
    plan: '只读规划',
    auto: '自动',
    dontAsk: '不询问',
    bypassPermissions: '跳过确认',
    minimal: '最小权限',
  }
  return map[mode] || mode
}

// 查看/编辑一个 bot 的人设与内部提示词。
// description 是 CLI 生成该 bot 系统提示词的素材：保存后只影响它之后的新回复。
export function AgentDetailDialog() {
  const agentId = useTeamStore((s) => s.detailAgentId)
  const agent = useTeamStore((s) => s.detailAgent)
  const loading = useTeamStore((s) => s.detailLoading)
  const detailError = useTeamStore((s) => s.detailError)
  const saving = useTeamStore((s) => s.savingAgent)
  const canManage = useTeamStore((s) => s.canManage)
  const closeAgentDetail = useTeamStore((s) => s.closeAgentDetail)
  const saveAgent = useTeamStore((s) => s.saveAgent)

  const [name, setName] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [error, setError] = React.useState('')
  const [confirmClose, setConfirmClose] = React.useState(false)

  const loadedId = agent?.id || ''
  // 详情是异步从 CLI 读回来的；把它灌进可编辑副本属于必要的同步
  // oxlint-disable-next-line react/set-state-in-effect
  React.useEffect(() => {
    if (!agentId || !agent || agent.id !== agentId) return
    setName(agent.name)
    setTitle(agent.title || '')
    setDescription(agent.description || '')
    setError('')
    setConfirmClose(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, loadedId, loading])

  const originalName = agent?.name || ''
  const originalTitle = agent?.title || ''
  const originalDescription = agent?.description || ''
  const dirty =
    !!agent &&
    (name !== originalName || title !== originalTitle || description !== originalDescription)
  const canSave = canManage && dirty && !saving && !!name.trim()

  const requestClose = () => {
    if (saving) return
    if (dirty) {
      setConfirmClose(true)
      return
    }
    closeAgentDetail()
  }

  const submit = async () => {
    if (!agentId || !canSave) return
    setError('')
    const result = await saveAgent({ id: agentId, name, title, description })
    if (!result.ok) {
      setError(result.error || '保存失败')
      return
    }
    setName(name.trim())
    setTitle(title.trim())
    setDescription(description.trim())
    setConfirmClose(false)
  }

  if (!agentId) return null

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : requestClose())}>
      <DialogContent id="agent-detail-dialog" className="w-[min(620px,calc(100vw-64px))]">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-4">
          <div className="flex items-center gap-2">
            <BotAvatar
              agentId={agentId}
              name={name || agent?.name || '智能体'}
              size={26}
            />
            <DialogTitle className="min-w-0 truncate">
              {agent?.name || '智能体详情'}
            </DialogTitle>
            {dirty && (
              <span id="agent-detail-dirty" className="shrink-0 text-[10.5px] text-warn">
                未保存
              </span>
            )}
          </div>
          <DialogDescription>
            人设与内部提示词决定这个 bot 怎么做事；保存后对它之后的新回复生效，已发出的消息不变。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && !agent && (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-ink-3">
              <Loader2 className="size-3.5 animate-spin" />
              正在读取人设…
            </div>
          )}

          {detailError && (
            <div className="mb-3 rounded-md border border-err/30 bg-err/8 px-2.5 py-1.5 text-[11px] leading-4 text-err">
              {detailError}
            </div>
          )}

          {agent && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="agent-detail-name" className="text-[11.5px] font-medium text-ink-2">
                    名字
                  </label>
                  <Input
                    id="agent-detail-name"
                    value={name}
                    maxLength={MAX_NAME}
                    disabled={!canManage || saving}
                    onChange={(event) => {
                      setName(event.target.value)
                      setError('')
                    }}
                    className="mt-1.5 h-8 text-[13px]"
                  />
                </div>
                <div>
                  <label htmlFor="agent-detail-title" className="text-[11.5px] font-medium text-ink-2">
                    角色（一行）
                  </label>
                  <Input
                    id="agent-detail-title"
                    value={title}
                    maxLength={MAX_NAME}
                    disabled={!canManage || saving}
                    placeholder="例如：接口与安全评审"
                    onChange={(event) => {
                      setTitle(event.target.value)
                      setError('')
                    }}
                    className="mt-1.5 h-8 text-[13px]"
                  />
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-baseline gap-2">
                  <label
                    htmlFor="agent-detail-description"
                    className="text-[11.5px] font-medium text-ink-2"
                  >
                    人设 / 内部提示词
                  </label>
                  <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                    {description.length}/{MAX_DESCRIPTION}
                  </span>
                </div>
                <Textarea
                  id="agent-detail-description"
                  value={description}
                  maxLength={MAX_DESCRIPTION}
                  rows={8}
                  disabled={!canManage || saving}
                  placeholder="写清这个 bot 的职责、边界与输出要求；它会作为该 bot 的系统提示词素材。"
                  onChange={(event) => {
                    setDescription(event.target.value)
                    setError('')
                  }}
                  className="mt-1.5 min-h-[168px] resize-y text-[13px] leading-[1.7]"
                />
                <div className="mt-1.5 text-[10.5px] leading-4 text-ink-4">
                  这段文字会注入该 bot 的系统提示词。改完保存后，它下一次回复就按新人设执行；
                  频道里已有的消息不会被改写。
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border/70 bg-surface-2/40 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[10.5px] text-ink-4">模型</div>
                  <div className="truncate font-mono text-[11.5px] text-ink-2">
                    {agent.model || '继承频道默认'}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[10.5px] text-ink-4">权限模式</div>
                  <div className="truncate text-[11.5px] text-ink-2">
                    {permissionLabel(agent.permissionMode)}
                  </div>
                </div>
                <div className="col-span-2 min-w-0">
                  <div className="text-[10.5px] text-ink-4">工作目录</div>
                  <div className="truncate font-mono text-[11px] text-ink-2" title={agent.homeCwd}>
                    {agent.homeCwd || '跟随频道'}
                  </div>
                </div>
              </div>

              {!canManage && (
                <div className="mt-3 text-[10.5px] leading-4 text-ink-4">
                  当前后端不支持编辑人设，这里只读展示。
                </div>
              )}
            </>
          )}

          {error && (
            <div id="agent-detail-error" className="mt-3 text-[11px] leading-4 text-err">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          {confirmClose ? (
            <>
              <span className="min-w-0 flex-1 text-[10.5px] text-warn">
                有未保存的修改，关闭后会丢失。
              </span>
              <button
                type="button"
                onClick={() => setConfirmClose(false)}
                className="rounded-md border border-border px-3 py-1.5 text-[12px] text-ink-2 transition-colors hover:bg-surface-2"
              >
                继续编辑
              </button>
              <button
                type="button"
                id="agent-detail-discard"
                onClick={closeAgentDetail}
                className="rounded-md border border-err/40 px-3 py-1.5 text-[12px] text-err transition-colors hover:bg-err/8"
              >
                放弃修改
              </button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-4">
                {dirty ? '改完记得保存' : '人设会随下一次回复生效'}
              </span>
              <button
                type="button"
                onClick={requestClose}
                className="rounded-md border border-border px-3 py-1.5 text-[12px] text-ink-2 transition-colors hover:bg-surface-2"
              >
                关闭
              </button>
              <button
                type="button"
                id="agent-detail-save"
                disabled={!canSave}
                onClick={() => void submit()}
                className={cn(
                  'inline-flex min-w-16 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
