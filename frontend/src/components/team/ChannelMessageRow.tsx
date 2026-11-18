import { Quote } from 'lucide-react'
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

interface QuotedInfo {
  text: string
  author: string
}

function QuoteBlock({
  messageId,
  targetId,
  quoted,
  missing,
  onJump,
}: {
  messageId: string
  targetId: string
  quoted?: QuotedInfo
  missing: boolean
  onJump: (id: string) => void
}) {
  return (
    <button
      type="button"
      id={`channel-quote-${messageId}`}
      disabled={missing || !quoted}
      onClick={() => !missing && quoted && onJump(targetId)}
      title={missing ? '原消息不在当前视图' : quoted ? `${quoted.author}：${quoted.text}` : undefined}
      className={cn(
        'mb-1 flex w-full min-w-0 items-baseline gap-1.5 rounded-[4px] border-l-2 border-border bg-surface-2/70 px-2 py-1 text-left text-[10.5px] leading-4 text-ink-3 transition-colors',
        missing || !quoted ? 'cursor-default italic text-ink-4' : 'hover:bg-surface-3/70',
      )}
    >
      <span className="shrink-0 font-medium text-ink-2">
        {missing || !quoted ? '原消息' : quoted.author}
      </span>
      <span className="truncate">
        {missing || !quoted ? '不在当前视图' : quoted.text.replace(/\s+/g, ' ').trim()}
      </span>
    </button>
  )
}

export function ChannelMessageRow({
  message,
  agent,
  presence,
  members,
  startOfRun,
  quoted,
  quotedMissing = false,
  highlighted = false,
  onQuote,
  onJump,
}: {
  message: ChannelMessage
  agent?: TeamAgent
  presence?: string
  members: TeamAgent[]
  startOfRun: boolean
  quoted?: QuotedInfo
  quotedMissing?: boolean
  highlighted?: boolean
  onQuote: () => void
  onJump: (id: string) => void
}) {
  const names = React.useMemo(() => mentionNames(members), [members])
  const isUser = message.from === 'user'
  const author: TeamAgent = agent || { id: message.agentId || 'unknown', name: '成员' }

  const quoteAction = (
    <button
      type="button"
      onClick={onQuote}
      title="引用这条消息"
      className="grid size-6 shrink-0 place-items-center self-center rounded-md text-ink-4 opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink-2 focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Quote className="size-3.5" />
    </button>
  )

  const quote = message.replyTo ? (
    <QuoteBlock
      messageId={message.id}
      targetId={message.replyTo}
      quoted={quoted}
      missing={quotedMissing}
      onJump={onJump}
    />
  ) : null

  if (isUser) {
    return (
      <div
        id={`channel-msg-${message.id}`}
        className="group -mx-1 flex scroll-mt-4 justify-end gap-1.5 rounded-lg px-1 pl-10"
        title={clock(message.at)}
      >
        {quoteAction}
        <div
          className={cn(
            'min-w-0 max-w-[min(84%,560px)] -mx-1 rounded-lg px-1 transition-colors',
            highlighted && 'bg-primary/10 ring-1 ring-primary/30',
          )}
        >
          {quote}
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
    <div
      id={`channel-msg-${message.id}`}
      className="group -mx-1 flex scroll-mt-4 items-start gap-2 rounded-lg px-1"
      title={clock(message.at)}
    >
      <div className="w-[22px] shrink-0 pt-0.5">
        {startOfRun && (
          <BotAvatar agentId={author.id} name={author.name} presence={presence} size={22} />
        )}
      </div>
      <div
        className={cn(
          'min-w-0 max-w-[min(84%,560px)] -mx-1 rounded-lg px-1 transition-colors',
          highlighted && 'bg-primary/10 ring-1 ring-primary/30',
        )}
      >
        {startOfRun && (
          <div className="mb-1 flex items-baseline gap-1.5 px-0.5">
            <span className="text-[11px] text-ink-3">{author.name}</span>
            {author.title && <span className="truncate text-[10px] text-ink-4">{author.title}</span>}
          </div>
        )}
        {quote}
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
      {quoteAction}
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
