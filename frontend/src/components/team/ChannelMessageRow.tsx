import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'
import type { ChannelMessage, TeamAgent } from '@/store/team'

import { BotAvatar } from './BotAvatar'
import { mentionNames, renderMentions } from './mentions'

function clock(at: number) {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 模块加载时取一次「今天」，避免在渲染里 new Date()（跨零点最多显示旧标签，不影响功能）
const TODAY = new Date()
const TODAY_KEY = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate()).getTime()
const YESTERDAY_KEY = TODAY_KEY - 86_400_000

export function ChannelMessageRow({
  message,
  agent,
  presence,
  members,
  startOfRun,
}: {
  message: ChannelMessage
  agent?: TeamAgent
  presence?: string
  members: TeamAgent[]
  startOfRun: boolean
}) {
  const names = React.useMemo(() => mentionNames(members), [members])
  const isUser = message.from === 'user'
  const author: TeamAgent = agent || { id: message.agentId || 'unknown', name: '成员' }

  if (isUser) {
    return (
      <div className="flex justify-end pl-10">
        <div className="max-w-[min(84%,560px)]" title={clock(message.at)}>
          <div
            className={cn(
              'whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-surface-3 px-3 py-2 text-[13.5px] leading-[1.7] text-ink',
              message.pending && 'opacity-70',
            )}
          >
            {renderMentions(message.text, names, 'bg-surface-2 text-ink-2')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2" title={clock(message.at)}>
      <div className="w-[22px] shrink-0 pt-0.5">
        {startOfRun && (
          <BotAvatar agentId={author.id} name={author.name} presence={presence} size={22} />
        )}
      </div>
      <div className="min-w-0 max-w-[min(84%,560px)]">
        {startOfRun && (
          <div className="mb-1 flex items-baseline gap-1.5 px-0.5">
            <span className="text-[11px] text-ink-3">{author.name}</span>
            {author.title && <span className="truncate text-[10px] text-ink-4">{author.title}</span>}
          </div>
        )}
        <div className="rounded-xl rounded-bl-sm bg-surface-2 px-3 py-2">
          <div className="chat-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p>{renderMentions(children, names, 'bg-surface-3 text-ink-2')}</p>,
                li: ({ children }) => <li>{renderMentions(children, names, 'bg-surface-3 text-ink-2')}</li>,
              }}
            >
              {message.text}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ChannelDayDivider({ at }: { at: number }) {
  const date = new Date(at)
  const startOfThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  let label = `${date.getMonth() + 1} 月 ${date.getDate()} 日`
  if (startOfThat === TODAY_KEY) label = '今天'
  else if (startOfThat === YESTERDAY_KEY) label = '昨天'
  return (
    <div className="flex justify-center py-1">
      <span className="text-[11px] text-ink-4">
        {label} {clock(at)}
      </span>
    </div>
  )
}
