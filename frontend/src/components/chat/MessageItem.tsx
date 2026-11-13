import {
  ActionBarPrimitive,
  MessagePrimitive,
  type ImageMessagePartProps,
  type ReasoningMessagePartProps,
  type TextMessagePartProps,
} from '@assistant-ui/react'
import { Copy } from 'lucide-react'

import { cn } from '@/lib/utils'
import { ImageViewer } from '@/components/media/ImageViewer'
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
    <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13.5px] leading-6 text-accent-foreground">
      {text}
    </div>
  )
}

function UserImage({ image, filename }: ImageMessagePartProps) {
  return (
    <ImageViewer
      src={image}
      alt={filename || '图片'}
      className="border-[#d9e3f6]"
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
    <details open={running} className="rounded-lg border-l-2 border-border py-1 pl-3">
      <summary className="cursor-pointer select-none text-[10.5px] text-muted-foreground">
        {running ? '思考中…' : '思考过程'}
      </summary>
      <div className="mt-1 whitespace-pre-wrap text-[12.5px] leading-6 text-muted-foreground">{text}</div>
    </details>
  )
}

export function MessageItem() {
  return (
    <MessagePrimitive.Root className="py-2.5">
      <MessagePrimitive.If user>
        <div className="flex justify-end">
          <div className="flex max-w-[82%] flex-col items-end gap-1">
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
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-[#6b4ff5] text-[10px] font-bold text-white">
            W
          </div>
          <div className="min-w-0 flex-1 space-y-3">
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
            <MessagePrimitive.If hasContent>
              <ActionBarPrimitive.Root className="flex items-center gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                <ActionBarPrimitive.Copy
                  title="复制"
                  className={cn('grid size-6 place-items-center rounded-md hover:bg-muted hover:text-foreground')}
                >
                  <Copy className="size-3" />
                </ActionBarPrimitive.Copy>
              </ActionBarPrimitive.Root>
            </MessagePrimitive.If>
          </div>
        </div>
      </MessagePrimitive.If>
    </MessagePrimitive.Root>
  )
}
