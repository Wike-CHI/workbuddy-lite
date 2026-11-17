import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppUpdateStore } from '@/store/appUpdate'

// 「重启并应用更新」的二次确认：更新本身不复杂，但会中断当前会话，必须先讲清楚
export function UpdateDialog() {
  const open = useAppUpdateStore((s) => s.confirmOpen)
  const close = useAppUpdateStore((s) => s.closeConfirm)
  const apply = useAppUpdateStore((s) => s.apply)

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <DialogContent className="max-w-[440px]">
        <div className="border-b border-border px-4 py-3 pr-12">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="size-4 text-primary" />
              重启并应用更新
            </DialogTitle>
            <DialogDescription>已编译好新版本，重启后自动回到当前会话。</DialogDescription>
          </DialogHeader>
        </div>
        <div className="space-y-3 px-4 py-4 text-xs leading-6 text-ink-2">
          <p>重启会中断当前会话，正在进行的一轮回答会被取消；几秒后应用会自动恢复。</p>
          <p className="text-ink-3">会话记录、模型与推理档位、当前频道和右侧工作台都会保留。</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
          <Button type="button" variant="outline" size="sm" onClick={close}>
            取消
          </Button>
          <Button id="app-update-confirm" type="button" size="sm" onClick={() => void apply()}>
            重启并应用
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
