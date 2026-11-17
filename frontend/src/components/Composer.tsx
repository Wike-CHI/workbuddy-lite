import { ComposerPrimitive, useAui } from '@assistant-ui/react'
import { ArrowUp, Blocks, Brain, ImagePlus, PanelsTopLeft, SlidersHorizontal, Square, X } from 'lucide-react'
import * as React from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { modelShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import { WidgetComposerDialog } from '@/components/intelligent/WidgetComposerDialog'
import { useChatStore } from '@/store/chat'
import { useUiStore } from '@/store/ui'
import type { AcpCommand, Attachment, CatalogSkill, ConfigOption, Connector } from '@/lib/types'

const MODES: { value: string; label: string }[] = [
  { value: 'default', label: '每次询问' },
  { value: 'acceptEdits', label: '自动改文件' },
  { value: 'plan', label: '只读规划' },
  { value: 'auto', label: '自动审查' },
  { value: 'dontAsk', label: '不询问' },
  { value: 'bypassPermissions', label: '跳过权限' },
  { value: 'fullAccess', label: '完全放行' },
]

const EFFORT_LABELS: Record<string, string> = {
  disabled: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
  enabled: '默认',
}

// ACP 只给英文名，常见配置项在壳里换成中文；未知项回落到服务端文案。
const CONFIG_LABELS: Record<string, string> = {
  sandbox: '运行环境',
  multitask: '多智能体协作',
  context_window: '上下文窗口',
  codeMode: '工具调用模式',
}

const CONFIG_VALUE_LABELS: Record<string, Record<string, string>> = {
  sandbox: { true: '沙箱', false: '本地' },
  codeMode: { off: '标准', all: 'PTC（全部工具）' },
}

const CONFIG_DESCRIPTIONS: Record<string, string> = {
  sandbox: '命令在隔离沙箱里执行',
  multitask: '自动拆分并行任务、协调子代理',
  context_window: '本轮可用的上下文长度',
  codeMode: '工具以 PTC 代码形式调用',
}

function effortLabel(value: string, fallback?: string) {
  return EFFORT_LABELS[value] || fallback || value
}

function configLabel(option: ConfigOption) {
  return CONFIG_LABELS[option.id] || option.name || option.id
}

function configDescription(option: ConfigOption) {
  return CONFIG_DESCRIPTIONS[option.id] || option.description || ''
}

function configValueLabel(option: ConfigOption, value: string, fallback?: string) {
  return CONFIG_VALUE_LABELS[option.id]?.[value] || fallback || value
}

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
  const model = useChatStore((s) => s.model)
  const models = useChatStore((s) => s.models)
  const setModel = useChatStore((s) => s.setModel)
  const mode = useChatStore((s) => s.mode)
  const setMode = useChatStore((s) => s.setMode)
  const thoughtLevel = useChatStore((s) => s.thoughtLevel)
  const setThoughtLevel = useChatStore((s) => s.setThoughtLevel)
  const configOptions = useChatStore((s) => s.configOptions)
  const configValues = useChatStore((s) => s.configValues)
  const setConfig = useChatStore((s) => s.setConfig)
  const setMarketOpen = useUiStore((s) => s.setMarketOpen)

  const currentModel = models.find((item) => item.id === model)
  const modeLabel = MODES.find((item) => item.value === mode)?.label || mode

  const thoughtOption = configOptions.find((item) => item.id === 'thought_level')
  const effortOptions = React.useMemo(() => {
    if (!thoughtOption) return []
    const allowed = currentModel?.effortOptions || []
    const base = allowed.length ? allowed : thoughtOption.options || []
    const list = base.map((item) => ({ value: item.value, label: effortLabel(item.value, item.name) }))
    if (
      thoughtOption.options?.some((item) => item.value === 'enabled') &&
      !list.some((item) => item.value === 'enabled')
    ) {
      list.push({ value: 'enabled', label: EFFORT_LABELS.enabled })
    }
    return list
  }, [thoughtOption, currentModel])
  const effortValue =
    effortOptions.find((item) => item.value === thoughtLevel)?.value ||
    effortOptions.find((item) => item.value === thoughtOption?.currentValue)?.value ||
    effortOptions[0]?.value ||
    ''
  const effortLabelText =
    effortOptions.find((item) => item.value === effortValue)?.label || effortValue

  // model / mode / thought_level 已在底栏单独露出，弹层只放其余能力
  const extraOptions = configOptions.filter(
    (item) => item && !['model', 'mode', 'thought_level'].includes(item.id),
  )

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
    <div className="shrink-0 px-4 pb-2.5 pt-2">
      <div
        className="relative mx-auto w-full max-w-[var(--composer-width)]"
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
            'rounded-xl border border-border bg-card transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10',
            dragging && 'border-primary/60 ring-2 ring-primary/15',
          )}
        >
          <div className="flex items-end gap-2 px-3 pt-2.5">
            <div className="min-w-0 flex-1">
              {(attachments.length > 0 || connectorRefs.length > 0) && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {attachments.map((attachment, index) => (
                    <div
                      key={attachment.name + index}
                      className="group relative size-11 overflow-hidden rounded-md border border-border bg-muted"
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
                      className="inline-flex h-6 max-w-48 items-center gap-1 rounded border border-border bg-surface-2 px-2 text-[11px] text-ink-2"
                    >
                      <span className="truncate">{name}</span>
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
                maxRows={10}
                placeholder={running ? '正在处理，点右侧停下…' : '描述任务，或输入 / 选技能、@ 引用连接器'}
                className="max-h-[240px] w-full resize-none border-0 bg-transparent px-0.5 py-1 text-[13.5px] leading-6 text-foreground outline-none placeholder:text-ink-4"
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
            <div className="flex shrink-0 items-center pb-1">
              {running ? (
                <button
                  type="button"
                  onClick={() => void cancel()}
                  title="停止"
                  className="grid size-7 place-items-center rounded-md border border-border text-ink-2 transition-colors hover:bg-surface-2"
                >
                  <Square className="size-3 fill-current" />
                </button>
              ) : (
                <button
                  id="send"
                  type="button"
                  title="发送 (Enter)"
                  disabled={!canSend}
                  onClick={submit}
                  className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
                >
                  <ArrowUp className="size-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-0.5 px-2 pb-1.5 pt-1">
            <Select value={model} onValueChange={(value) => void setModel(value)}>
              <SelectTrigger
                className="h-6 w-auto gap-1 rounded border-0 bg-transparent px-1.5 text-[11.5px] text-ink-2 shadow-none hover:bg-surface-2 focus:ring-0"
                title="模型"
              >
                <span className="max-w-[150px] truncate font-mono">
                  {currentModel ? modelShort(currentModel) : model || '模型'}
                </span>
              </SelectTrigger>
              <SelectContent align="start" className="max-w-[320px]">
                {models.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {modelShort(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {effortOptions.length > 0 && (
              <Select value={effortValue} onValueChange={setThoughtLevel}>
                <SelectTrigger
                  className="h-6 w-auto gap-1 rounded border-0 bg-transparent px-1.5 text-[11.5px] text-ink-2 shadow-none hover:bg-surface-2 focus:ring-0"
                  title="思考强度（effort）"
                >
                  <Brain className="size-3 shrink-0 text-ink-3" />
                  <span className="max-w-[84px] truncate">思考·{effortLabelText}</span>
                </SelectTrigger>
                <SelectContent align="start">
                  {effortOptions.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger
                className="h-6 w-auto gap-1 rounded border-0 bg-transparent px-1.5 text-[11.5px] text-ink-2 shadow-none hover:bg-surface-2 focus:ring-0"
                title="权限模式"
              >
                <span className="max-w-[110px] truncate">{modeLabel}</span>
              </SelectTrigger>
              <SelectContent align="start">
                {MODES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {extraOptions.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    id="session-config"
                    type="button"
                    className="grid size-6 place-items-center rounded text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
                    title="会话能力（运行环境 / 协作 / 上下文）"
                  >
                    <SlidersHorizontal className="size-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-64 p-2">
                  <div className="px-2 pb-1.5 pt-0.5">
                    <div className="text-[11px] font-medium text-ink-2">会话能力</div>
                    <div className="text-[10px] text-ink-4">由当前 CodeBuddy 会话提供</div>
                  </div>
                  {extraOptions.map((option) => {
                    const raw = configValues[option.id] ?? option.currentValue
                    if (option.type === 'boolean') {
                      const on = raw === true || raw === 'true'
                      return (
                        <div
                          key={option.id}
                          className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2/60"
                        >
                          <div className="min-w-0">
                            <div className="text-[11.5px] font-medium text-ink-2">{configLabel(option)}</div>
                            {configDescription(option) && (
                              <div className="truncate text-[10px] text-ink-4">{configDescription(option)}</div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => void setConfig(option.id, !on)}
                            className={cn(
                              'h-5 shrink-0 rounded-full px-2 text-[10.5px] font-medium transition-colors',
                              on
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-ink-3 hover:text-ink-2',
                            )}
                          >
                            {on ? '开' : '关'}
                          </button>
                        </div>
                      )
                    }
                    const values = option.options || []
                    if (!values.length) return null
                    const current = String(raw ?? values[0].value)
                    return (
                      <div
                        key={option.id}
                        className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2/60"
                      >
                        <div className="min-w-0">
                          <div className="text-[11.5px] font-medium text-ink-2">{configLabel(option)}</div>
                          {configDescription(option) && (
                            <div className="truncate text-[10px] text-ink-4">{configDescription(option)}</div>
                          )}
                        </div>
                        <Select value={current} onValueChange={(value) => void setConfig(option.id, value)}>
                          <SelectTrigger className="h-6 w-auto shrink-0 gap-1 rounded border border-border bg-surface-2 px-1.5 text-[11px] text-ink-2 shadow-none hover:bg-muted focus:ring-0">
                            <span className="max-w-[96px] truncate">
                              {configValueLabel(
                                option,
                                current,
                                values.find((item) => item.value === current)?.name,
                              )}
                            </span>
                          </SelectTrigger>
                          <SelectContent align="end" className="max-w-[240px]">
                            {values.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {configValueLabel(option, item.value, item.name)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </PopoverContent>
              </Popover>
            )}

            <span className="mx-1 h-3 w-px bg-border" />

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
            <button
              type="button"
              className="grid size-6 place-items-center rounded text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
              title="添加图片（也可粘贴或拖入）"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-3.5" />
            </button>
            <button
              type="button"
              className="grid size-6 place-items-center rounded text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
              title="生成交互回答（地图 / 图表 / 表单 / 文章）"
              onClick={() => setIuiOpen(true)}
            >
              <PanelsTopLeft className="size-3.5" />
            </button>
            <button
              type="button"
              className="grid size-6 place-items-center rounded text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
              title="技能 / 连接器"
              onClick={() => setMarketOpen(true)}
            >
              <Blocks className="size-3.5" />
            </button>

            <span className="flex-1" />
            {charCount > 0 && <span className="pr-1 font-mono text-[10.5px] text-ink-4">{charCount} 字</span>}
            <span className="pr-1 text-[10.5px] text-ink-4">Enter 发送</span>
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

        <div className="mx-auto mt-1.5 hidden" aria-hidden />
      </div>
    </div>
  )
}
