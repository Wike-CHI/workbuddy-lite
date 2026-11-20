import {
  ActionBarPrimitive,
  MessagePrimitive,
  type ImageMessagePartProps,
  type ReasoningMessagePartProps,
  type TextMessagePartProps,
} from '@assistant-ui/react'
import { ChevronRight, Copy } from 'lucide-react'

import { ImageViewer } from '@/components/media/ImageViewer'
import { cn } from '@/lib/utils'

import { ErrorPart } from './ErrorPart'
import { MarkdownPart } from './MarkdownPart'
import { PermissionPart } from './PermissionPart'
import { PlanPart } from './PlanPart'
import { ToolPart } from './ToolPart'
import { UsagePart } from './UsagePart'
import { UserMetaPart } from './UserMetaPart'

function UserText({ text }: TextMessagePartProps) {
  if (!text) return null
  return (
    <div className="whitespace-pre-wrap break-words border-l-2 border-primary/40 bg-surface-2/50 px-3 py-2 text-[13px] leading-6 text-ink">
      {text}
    </div>
  )
}

function UserImage({ image, filename }: ImageMessagePartProps) {
  return (
    <ImageViewer
      src={image}
      alt={filename || '图片'}
      className="border-border"
      imageClassName="max-h-40 max-w-48"
    />
  )
}

function AssistantImage({ image, filename }: ImageMessagePartProps) {
  return <ImageViewer src={image} alt={filename || '图片'} imageClassName="max-h-80 max-w-full object-contain" />
}

function ReasoningPart({ text, status }: ReasoningMessagePartProps) {
  if (!text) return null
  const running = status?.type === 'running'
  return (
    <details open={running} className="group/reason border-l-2 border-border/70 pl-3">
      <summary className="flex cursor-pointer select-none items-center gap-1 text-[11px] text-ink-4 hover:text-ink-2">
        <ChevronRight className="size-3 transition-transform duration-[var(--dur-base)] ease-out group-open/reason:rotate-90" />
        {running ? '思考中…' : '思考过程'}
      </summary>
      <div className="mt-1 whitespace-pre-wrap text-[12px] leading-6 text-ink-3">{text}</div>
    </details>
  )
}

export function MessageItem() {
  return (
    <MessagePrimitive.Root className="rise-in group py-2">
      <MessagePrimitive.If user>
        <div className="flex justify-start py-2">
          <div className="flex max-w-[88%] flex-col items-start gap-1">
            <MessagePrimitive.Parts
              components={{
                Text: UserText,
                Image: UserImage,
                data: { by_name: { 'user-meta': UserMetaPart } },
              }}
            />
          </div>
        </div>
      </MessagePrimitive.If>

      <MessagePrimitive.If assistant>
        <div className="min-w-0 py-1">
          <div className="space-y-2.5">
            <MessagePrimitive.Parts
              components={{
                Text: MarkdownPart,
                Reasoning: ReasoningPart,
                Image: AssistantImage,
                tools: { Fallback: ToolPart },
                data: {
                  by_name: {
                    plan: PlanPart,
                    permission: PermissionPart,
                    usage: UsagePart,
                    error: ErrorPart,
                  },
                },
              }}
            />
          </div>
          <MessagePrimitive.If hasContent>
            <ActionBarPrimitive.Root className="mt-1 flex items-center gap-1 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100">
              <ActionBarPrimitive.Copy
                title="复制"
                className={cn('grid size-6 place-items-center rounded hover:bg-surface-2 hover:text-ink-2')}
              >
                <Copy className="size-3" />
              </ActionBarPrimitive.Copy>
            </ActionBarPrimitive.Root>
          </MessagePrimitive.If>
        </div>
      </MessagePrimitive.If>
    </MessagePrimitive.Root>
  )
}
