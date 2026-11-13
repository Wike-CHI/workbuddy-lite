import { ThreadPrimitive } from '@assistant-ui/react'
import { Sparkles } from 'lucide-react'

import { MessageItem } from './MessageItem'
import { useChatStore } from '@/store/chat'

const SUGGESTIONS = [
  '看看当前目录有什么，列个清单',
  '把 README 里的 TODO 整理成一份计划',
  '找出这个项目里最大的三个文件',
]

export function ChatThread() {
  const activeId = useChatStore((s) => s.activeId)
  const send = useChatStore((s) => s.send)

  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport
        id="thread-viewport"
        key={activeId || 'new'}
        className="min-h-0 flex-1 overflow-y-auto scroll-smooth"
      >
        <div className="mx-auto flex w-full max-w-[820px] flex-col px-6 py-6">
          <ThreadPrimitive.Empty>
            <div className="pt-[10vh] text-center">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-accent text-primary">
                <Sparkles className="size-6" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">说点什么，让它动手</h2>
              <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted-foreground">
                这个壳只做三件事：把话递给 CodeBuddy、把工具调用画清楚、把权限交回你手里。
              </p>
              <div className="mx-auto mt-6 flex max-w-md flex-col gap-2">
                {SUGGESTIONS.map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => void send(text)}
                    className="rounded-xl border border-border bg-card px-3.5 py-2 text-[13px] text-muted-foreground transition-colors hover:border-[#cdd3dc] hover:text-foreground"
                  >
                    {text}
                  </button>
                ))}
              </div>
              <p className="mt-5 text-[12px] text-muted-foreground">
                输入 <code className="rounded bg-muted px-1 py-0.5 text-[11.5px]">/</code> 选技能，
                <code className="rounded bg-muted px-1 py-0.5 text-[11.5px]">@</code> 选连接器，也可以直接粘贴或拖进图片。
              </p>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages>{() => <MessageItem />}</ThreadPrimitive.Messages>
          <div className="h-8" />
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  )
}
