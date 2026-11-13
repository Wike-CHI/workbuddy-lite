import { Coins, RefreshCw, Sparkles, Terminal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { fmtCredits, fmtNum, fmtReset, modelShort, multiplierOf } from '@/lib/format'
import { useChatStore } from '@/store/chat'
import { useUiStore } from '@/store/ui'

export function UsageDialog() {
  const open = useUiStore((s) => s.usageOpen)
  const setOpen = useUiStore((s) => s.setUsageOpen)
  const usage = useChatStore((s) => s.usage)
  const quota = useChatStore((s) => s.quota)
  const model = useChatStore((s) => s.model)
  const models = useChatStore((s) => s.models)
  const loadUsage = useChatStore((s) => s.loadUsage)
  const send = useChatStore((s) => s.send)

  const q = usage?.quota || quota || {}
  const pct = q.percent !== undefined ? Number(q.percent) : null
  const currentModel = models.find((m) => m.id === model)
  const multiplier = multiplierOf(currentModel)
  const sessions = (usage?.sessions || []).filter((s) => Number(s.credits || 0) > 0).slice(0, 8)
  const stats = usage?.cliStats
  let tokens = 0
  if (stats) {
    for (const item of Object.values(stats.modelUsage || {})) {
      tokens += Number(item.inputTokens || 0) + Number(item.outputTokens || 0)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[720px]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 pr-12">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Coins className="size-4 text-warning" />
            积分与预算
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] font-normal"
            onClick={() => void loadUsage()}
          >
            <RefreshCw className="size-3" />
            刷新
          </Button>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-4">
          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10.5px] tracking-wide text-muted-foreground">共享积分预算</div>
                <div className="mt-0.5 font-mono text-[26px] font-semibold leading-tight">
                  {pct === null ? '—' : pct.toFixed(1) + '%'}
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">已用</span>
                </div>
              </div>
              <div className="text-right text-[11px] leading-5 text-muted-foreground">
                <div>额度模型 {q.model || '—'}</div>
                <div>重置 {fmtReset(q.resetAt)}</div>
              </div>
            </div>
            <Progress className="mt-3" value={pct === null ? 0 : Math.max(0, Math.min(100, pct))} />
            <div className="mt-2 text-[10.5px] text-muted-foreground">
              预算百分比来自 CodeBuddy 的 <code className="rounded bg-card px-1">usage_update.quota</code>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="本工作空间积分" value={fmtCredits(usage?.workspaceCredits)} />
            <Stat label="本工作空间今日" value={fmtCredits(usage?.workspaceToday)} />
            <Stat label="全部累计积分" value={fmtCredits(usage?.totalCredits)} />
            <Stat label="实际扣除" value={fmtCredits(usage?.totalCharged)} />
          </div>

          <section>
            <h3 className="mb-1.5 text-[10.5px] font-medium tracking-wide text-muted-foreground">当前模型</h3>
            <div className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs">
              <span className="truncate">{currentModel ? modelShort(currentModel) : model || '—'}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {multiplier === null ? '' : multiplier === 0 ? '免费' : '×' + multiplier + ' 积分倍率'}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              本轮积分按 <code className="rounded bg-muted px-1">original_credit</code> 记录，实际扣除以{' '}
              <code className="rounded bg-muted px-1">credit</code> 为准；免费模型会显示「免费额度」。
            </p>
          </section>

          <section>
            <h3 className="mb-1.5 text-[10.5px] font-medium tracking-wide text-muted-foreground">最近会话</h3>
            {!sessions.length && <div className="py-4 text-center text-xs text-muted-foreground">还没有积分记录</div>}
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted/40">
                <span className="min-w-0 flex-1 truncate">{session.title || '新会话'}</span>
                {session.inWorkspace && (
                  <span className="rounded bg-[#eaf7f0] px-1 py-0.5 text-[9.5px] text-success">本空间</span>
                )}
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {fmtCredits(session.credits)} 积分
                </span>
              </div>
            ))}
          </section>

          <section>
            <h3 className="mb-1.5 text-[10.5px] font-medium tracking-wide text-muted-foreground">
              CodeBuddy 历史用量
            </h3>
            {!stats ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                演示模式不读取全局统计 / Agent 未就绪时读不到
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="历史会话" value={String(stats.totalSessions || 0)} />
                <Stat label="历史消息" value={fmtNum(stats.totalMessages)} />
                <Stat label="历史 Token" value={fmtNum(tokens)} />
                <Stat label="使用过的模型" value={String(Object.keys(stats.modelUsage || {}).length)} />
              </div>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setOpen(false)
                void send('/cost')
              }}
            >
              <Terminal className="size-3.5" />
              让 CodeBuddy 跑 /cost 核对
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => void loadUsage()}>
              <Sparkles className="size-3.5" />
              重新读取额度
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-2">
      <div className="font-mono text-base font-semibold leading-tight">{value || '0'}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}
