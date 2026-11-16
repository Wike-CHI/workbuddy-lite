import { ThreadPrimitive } from '@assistant-ui/react'
import { ChevronRight } from 'lucide-react'

import { useChatStore } from '@/store/chat'

import { MessageItem } from './MessageItem'

const SUGGESTIONS = [
  '看看当前目录有什么，列个清单',
  '把 README 里的 TODO 整理成一份计划',
  '找出这个项目里最大的三个文件',
]

export function ChatThread() {
  const activeId = useChatStore((s) => s.activeId)
  const send = useChatStore((s) => s.send)
  const workspaceName = useChatStore((s) => s.workspaceName)

  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport
        id="thread-viewport"
        key={activeId || 'new'}
        className="min-h-0 flex-1 overflow-y-auto scroll-smooth"
      >
        <div className="mx-auto flex w-full max-w-[760px] flex-col px-4 py-5">
          <ThreadPrimitive.Empty>
            <div className="pt-[12vh]">
              <div className="mx-auto max-w-[560px]">
                <div className="font-mono text-[11px] text-ink-4">{workspaceName || '未命名工作空间'}</div>
                <h2 className="mt-1 text-[15px] font-medium tracking-[-0.01em] text-ink">新会话</h2>
                <p className="mt-1 text-[12.5px] leading-5 text-ink-3">给它一个任务，或者从下面挑一个开始。</p>

                <div className="mt-5 border-y border-border/70">
                  {SUGGESTIONS.map((text) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => void send(text)}
                      className="group flex w-full items-center gap-2 border-b border-border/70 py-2 text-left text-[12.5px] text-ink-2 transition-colors last:border-b-0 hover:text-ink"
                    >
                      <ChevronRight className="size-3 shrink-0 text-ink-4 transition-colors group-hover:text-primary" />
                      <span className="min-w-0 flex-1 truncate">{text}</span>
                      <span className="shrink-0 text-[10.5px] text-ink-4 opacity-0 transition-opacity group-hover:opacity-100">
                        发送
                      </span>
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-ink-4">
                  <span className="flex items-center gap-1">
                    <kbd className="rounded border border-border px-1 font-mono text-[10px]">/</kbd>
                    技能与命令
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded border border-border px-1 font-mono text-[10px]">@</kbd>
                    连接器
                  </span>
                  <span>粘贴或拖入图片</span>
                </div>
              </div>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages>{() => <MessageItem />}</ThreadPrimitive.Messages>
          <div className="h-6" />
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  )
}
