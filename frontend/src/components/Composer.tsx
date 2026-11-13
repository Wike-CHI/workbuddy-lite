import { ComposerPrimitive, useAui } from '@assistant-ui/react'
import {
  ArrowUp,
  ImagePlus,
  Plus,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { WidgetComposerDialog } from '@/components/intelligent/WidgetComposerDialog'
import { useChatStore } from '@/store/chat'
import { useUiStore } from '@/store/ui'
import type { AcpCommand, Attachment, CatalogSkill, Connector } from '@/lib/types'

const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

type PaletteMode = 'skill' | 'connector'

interface PaletteState {
  mode: PaletteMode
  query: string
  start: number
  end: number
  index: number
}

function detectPalette(value: string, cursor: number): PaletteState | null {
  const before = value.slice(0, cursor)
  const match = before.match(/(^|[\s\u3000])([/@])([^\s/@]*)$/)
  if (!match) return null
  return {
    mode: match[2] === '/' ? 'skill' : 'connector',
    query: match[3],
    start: cursor - match[2].length - match[3].length,
    end: cursor,
    index: 0,
  }
}

function skillList(skills: CatalogSkill[], commands: AcpCommand[]) {
  const map = new Map<string, { name: string; description?: string; hint?: string; source?: string }>()
  for (const skill of skills) {
    map.set(skill.name, {
      name: skill.name,
      description: skill.description,
      hint: skill.hint,
      source: skill.source === 'project' ? '项目' : '用户',
    })
  }
  for (const command of commands) {
    const prev = map.get(command.name) || { name: command.name }
    map.set(command.name, { ...prev, ...command, source: 'CodeBuddy' })
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function connectorList(connectors: Connector[]) {
  return [...connectors].sort((a, b) => a.name.localeCompare(b.name))
}

function filterItems<T extends { name: string; description?: string }>(items: T[], query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items
    .filter((item) => `${item.name} ${item.description || ''}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1
      return ap - bp || a.name.localeCompare(b.name)
    })
}

function readImage(file: File): Promise<Attachment | null> {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type || '') || file.size > MAX_IMAGE_BYTES) {
      resolve(null)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const comma = dataUrl.indexOf(',')
      if (comma < 0) {
        resolve(null)
        return
      }
      resolve({
        name: file.name || '粘贴的图片',
        mime: file.type || 'image/png',
        dataUrl,
        data: dataUrl.slice(comma + 1),
      })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export function Composer() {
  const aui = useAui()
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const composing = React.useRef(false)
  const [value, setValue] = React.useState('')
  const [palette, setPalette] = React.useState<PaletteState | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [iuiOpen, setIuiOpen] = React.useState(false)
  const [historyIndex, setHistoryIndex] = React.useState(-1)

  const running = useChatStore((s) => s.running)
  const attachments = useChatStore((s) => s.attachments)
  const connectorRefs = useChatStore((s) => s.connectorRefs)
  const catalog = useChatStore((s) => s.catalog)
  const commands = useChatStore((s) => s.commands)
  const history = useChatStore((s) => s.history)
  const activeId = useChatStore((s) => s.activeId)
  const cwd = useChatStore((s) => s.cwd)
  const addAttachment = useChatStore((s) => s.addAttachment)
  const removeAttachment = useChatStore((s) => s.removeAttachment)
  const addConnector = useChatStore((s) => s.addConnector)
  const removeConnector = useChatStore((s) => s.removeConnector)
  const getDraft = useChatStore((s) => s.getDraft)
  const setDraft = useChatStore((s) => s.setDraft)
  const send = useChatStore((s) => s.send)
  const cancel = useChatStore((s) => s.cancel)
  const setMarketOpen = useUiStore((s) => s.setMarketOpen)

  const skills = React.useMemo(() => skillList(catalog.skills, commands), [catalog.skills, commands])
  const connectors = React.useMemo(() => connectorList(catalog.connectors), [catalog.connectors])
  const paletteItems = React.useMemo(() => {
    if (!palette) return []
    const list = palette.mode === 'skill' ? skills : connectors
    return filterItems(list, palette.query)
  }, [palette, skills, connectors])

  // 切会话 / 换工作空间时恢复草稿
  React.useEffect(() => {
    const draft = getDraft()
    setValue(draft)
    setPalette(null)
    setHistoryIndex(-1)
    aui.composer.setText(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, cwd])

  // 自动化验证钩子：把文本塞进 composer 并触发 / 或 @ 弹层
  const applyValue = React.useCallback(
    (next: string, caret?: number) => {
      setValue(next)
      setDraft(next)
      aui.composer.setText(next)
      if (caret !== undefined) {
        requestAnimationFrame(() => {
          inputRef.current?.focus()
          inputRef.current?.setSelectionRange(caret, caret)
        })
      }
    },
    [aui, setDraft],
  )

  const updatePalette = React.useCallback(
    (next: string, cursor: number) => {
      const ctx = detectPalette(next, cursor)
      setPalette(ctx)
    },
    [],
  )

  React.useEffect(() => {
    const w = window as unknown as { __wbl?: Record<string, unknown> }
    w.__wbl = w.__wbl || {}
    w.__wbl.setComposerText = (text: string) => {
      applyValue(text, text.length)
      updatePalette(text, text.length)
      inputRef.current?.focus()
    }
  }, [applyValue, updatePalette])

  const pickPalette = (index: number) => {
    if (!palette) return
    const item = paletteItems[index]
    if (!item) return
    if (palette.mode === 'skill') {
      const before = value.slice(0, palette.start)
      const after = value.slice(palette.end)
      const insert = '/' + item.name + ' '
      applyValue(before + insert + after, palette.start + insert.length)
    } else {
      const before = value.slice(0, palette.start)
      const after = value.slice(palette.end)
      addConnector(item.name)
      applyValue(before + after, palette.start)
    }
    setPalette(null)
  }

  const submit = () => {
    if (running) return
    const text = value
    if (!text.trim() && !attachments.length) return
    setValue('')
    setPalette(null)
    aui.composer.setText('')
    void send(text)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
    if (palette) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setPalette((prev) => (prev ? { ...prev, index: (prev.index + 1) % Math.max(1, paletteItems.length) } : prev))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setPalette((prev) =>
          prev
            ? { ...prev, index: (prev.index - 1 + Math.max(1, paletteItems.length)) % Math.max(1, paletteItems.length) }
            : prev,
        )
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        pickPalette(palette.index)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setPalette(null)
        return
      }
    }

    if (event.key === 'ArrowUp' && !value.trim() && history.length) {
      event.preventDefault()
      const nextIndex = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(nextIndex)
      applyValue(history[nextIndex], history[nextIndex].length)
      return
    }
    if (event.key === 'ArrowDown' && historyIndex >= 0) {
      event.preventDefault()
      const nextIndex = historyIndex + 1
      if (nextIndex >= history.length) {
        setHistoryIndex(-1)
        applyValue('', 0)
      } else {
        setHistoryIndex(nextIndex)
        applyValue(history[nextIndex], history[nextIndex].length)
      }
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const handleFiles = async (files: FileList | File[]) => {
    const list = [...files]
    for (const file of list) {
      if (attachments.length >= MAX_IMAGES) break
      const attachment = await readImage(file)
      if (attachment) addAttachment(attachment)
    }
  }

  const charCount = [...value].length
  const canSend = (!!value.trim() || attachments.length > 0) && !running

  return (
    <div className="shrink-0 px-6 pb-3 pt-2">
      <div
        className="relative mx-auto w-full max-w-[820px]"
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (event.dataTransfer?.files?.length) void handleFiles(event.dataTransfer.files)
        }}
      >
        {palette && (
          <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
            <div className="border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
              {palette.mode === 'skill'
                ? '技能 / 命令 · 上下键选择 · Enter 插入 · Esc 关闭'
                : '连接器（MCP） · 上下键选择 · Enter 引用'}
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
              {!paletteItems.length && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  没有匹配的{palette.mode === 'skill' ? '技能或命令' : '连接器'}
                </div>
              )}
              {paletteItems.map((item, index) => {
                const hint =
                  palette.mode === 'skill'
                    ? `${(item as { source?: string }).source || ''}${(item as { hint?: string }).hint ? ' · ' + (item as { hint?: string }).hint : ''}`
                    : `${(item as Connector).disabled ? '已停用' : (item as Connector).type || 'stdio'}`
                return (
                  <button
                    key={item.name}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      pickPalette(index)
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left',
                      index === palette.index ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                    )}
                  >
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded bg-muted text-[10px] text-muted-foreground">
                      {palette.mode === 'skill' ? '/' : '⌁'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[12.5px] font-medium">{item.name}</span>
                        <span className="truncate text-[10px] text-muted-foreground">{hint}</span>
                      </span>
                      <span className="line-clamp-2 text-[11px] text-muted-foreground">{item.description || ''}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <ComposerPrimitive.Root
          className={cn(
            'flex items-end gap-2 rounded-2xl border border-border bg-card px-3.5 py-2.5 shadow-sm transition-all focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15',
            dragging && 'border-primary ring-4 ring-primary/10',
          )}
        >
          <div className="min-w-0 flex-1">
            {(attachments.length > 0 || connectorRefs.length > 0) && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {attachments.map((attachment, index) => (
                  <div
                    key={attachment.name + index}
                    className="group relative size-12 overflow-hidden rounded-lg border border-border bg-muted"
                    title={attachment.name}
                  >
                    <img src={attachment.dataUrl} alt={attachment.name} className="size-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      title="移除"
                    >
                      <X className="size-2.5" />
                    </button>
                  </div>
                ))}
                {connectorRefs.map((name) => (
                  <span
                    key={name}
                    className="inline-flex h-6 max-w-48 items-center gap-1 rounded-md border border-[#d6e3fb] bg-accent px-2 text-[11px] text-accent-foreground"
                  >
                    <span className="truncate">⌁ {name}</span>
                    <button type="button" onClick={() => removeConnector(name)} title="取消引用">
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <ComposerPrimitive.Input
              id="input"
              ref={inputRef}
              submitMode="none"
              minRows={1}
              maxRows={8}
              placeholder={
                running
                  ? '正在处理，点右侧 ■ 停止…'
                  : '输入消息，Enter 发送 · Shift+Enter 换行 · / 技能 · @ 连接器'
              }
              className="max-h-[220px] w-full resize-none border-0 bg-transparent py-1 text-[14px] leading-6 text-foreground outline-none placeholder:text-[#a2a8b2]"
              onChange={(event) => {
                const next = event.target.value
                setValue(next)
                setDraft(next)
                setHistoryIndex(-1)
                updatePalette(next, event.target.selectionStart ?? next.length)
              }}
              onClick={(event) => updatePalette(value, event.currentTarget.selectionStart ?? value.length)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={(event) => {
                composing.current = false
                const next = event.currentTarget.value
                updatePalette(next, event.currentTarget.selectionStart ?? next.length)
              }}
              onPaste={(event) => {
                const files: File[] = []
                for (const item of event.clipboardData?.items || []) {
                  if (item.kind === 'file') {
                    const file = item.getAsFile()
                    if (file && /^image\//.test(file.type || '')) files.push(file)
                  }
                }
                if (files.length) {
                  event.preventDefault()
                  void handleFiles(files)
                }
              }}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void handleFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 rounded-lg text-muted-foreground"
              title="生成交互回答（地图 / 图表 / 表单 / 文章）"
              onClick={() => setIuiOpen(true)}
            >
              <Sparkles className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 rounded-lg text-muted-foreground"
              title="添加图片（也可粘贴或拖入）"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-4" />
            </Button>
            {running ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8 rounded-lg"
                title="停止"
                onClick={() => void cancel()}
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                id="send"
                type="button"
                size="icon"
                className="size-8 rounded-lg"
                title="发送"
                disabled={!canSend}
                onClick={submit}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </ComposerPrimitive.Root>

        <WidgetComposerDialog
          open={iuiOpen}
          onOpenChange={setIuiOpen}
          onGenerate={(prompt, sendNow) => {
            if (sendNow) {
              setValue('')
              setPalette(null)
              aui.composer.setText('')
              void send(prompt)
            } else {
              applyValue(prompt, prompt.length)
            }
          }}
        />

        <div className="mx-auto mt-1.5 flex w-full items-center gap-1.5 px-1 text-[10.5px] text-muted-foreground">
          <span>{running ? '工作中' : '就绪'}</span>
          <span>·</span>
          <span>Enter 发送 · Shift+Enter 换行</span>
          <span className="flex-1" />
          <span className="font-mono">{charCount} 字</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10.5px] font-normal"
            onClick={() => setMarketOpen(true)}
          >
            <Plus className="mr-1 size-3" />
            技能 / 连接器
          </Button>
        </div>
      </div>
    </div>
  )
}
