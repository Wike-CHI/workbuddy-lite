import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  FileText,
  Map as MapIcon,
  Palette,
  Plus,
  Save,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIntelligentUiStore } from '@/store/intelligentUi'
import type { SavedWidget, VisualTemplate, WidgetKind } from '@/lib/types'
import { IntelligentUiWidget } from './IntelligentUiWidget'

const TYPE_META: Record<WidgetKind, { label: string; icon: typeof BarChart3 }> = {
  chart: { label: '图表', icon: BarChart3 },
  map: { label: '地图', icon: MapIcon },
  form: { label: '表单', icon: ClipboardList },
  article: { label: '文章', icon: FileText },
}

function timeText(ts: number) {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function IntelligentUiLibraryDialog() {
  const open = useIntelligentUiStore((s) => s.libraryOpen)
  const tab = useIntelligentUiStore((s) => s.libraryTab)
  const setLibraryOpen = useIntelligentUiStore((s) => s.setLibraryOpen)
  const templates = useIntelligentUiStore((s) => s.templates)
  const saved = useIntelligentUiStore((s) => s.saved)
  const defaultTemplateId = useIntelligentUiStore((s) => s.defaultTemplateId)
  const deleteWidget = useIntelligentUiStore((s) => s.deleteWidget)
  const upsertTemplate = useIntelligentUiStore((s) => s.upsertTemplate)
  const deleteTemplate = useIntelligentUiStore((s) => s.deleteTemplate)
  const setDefaultTemplate = useIntelligentUiStore((s) => s.setDefaultTemplate)

  const [preview, setPreview] = React.useState<SavedWidget | null>(null)
  const [draft, setDraft] = React.useState<VisualTemplate | null>(null)

  React.useEffect(() => {
    if (!open) {
      setPreview(null)
      return
    }
    if (tab === 'templates') {
      setDraft((prev) => {
        if (prev && templates.some((t) => t.id === prev.id)) return prev
        return templates[0] || null
      })
    }
  }, [open, tab, templates])

  const sorted = [...saved].sort((a, b) => b.updatedAt - a.updatedAt)
  const activeDraft = draft && templates.some((t) => t.id === draft.id) ? draft : templates[0] || null

  const updateDraft = (patch: Partial<VisualTemplate>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }
  const updateTheme = (patch: Partial<VisualTemplate['theme']>) => {
    setDraft((prev) => (prev ? { ...prev, theme: { ...prev.theme, ...patch } } : prev))
  }

  const newTemplate = () => {
    const base = activeDraft || templates[0]
    if (!base) return
    const next: VisualTemplate = {
      ...base,
      id: `tpl_${Date.now().toString(36)}`,
      name: base.name + ' 副本',
      builtin: false,
      theme: { ...base.theme, palette: [...base.theme.palette] },
    }
    upsertTemplate(next)
    setDraft(next)
    toast.success('已新建模板，编辑后点保存')
  }

  const saveTemplate = () => {
    if (!activeDraft) return
    const next = { ...activeDraft, name: activeDraft.name.trim() || '未命名模板' }
    upsertTemplate(next)
    setDraft(next)
    toast.success('模板已保存')
  }

  const removeTemplate = () => {
    if (!activeDraft) return
    if (templates.length <= 1) {
      toast.warning('至少保留一个模板')
      return
    }
    deleteTemplate(activeDraft.id)
    setDraft(null)
    toast.success('模板已删除')
  }

  return (
    <Dialog open={open} onOpenChange={(value) => setLibraryOpen(value)}>
      <DialogContent className="h-[min(780px,calc(100vh-50px))] w-[min(1000px,calc(100vw-40px))] max-w-none">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          {preview ? (
            <>
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setPreview(null)}>
                <ArrowLeft className="size-3" />
                返回
              </Button>
              <span className="truncate text-sm font-semibold">{preview.title}</span>
              <Badge variant="secondary">{TYPE_META[preview.spec.type]?.label || '交互'}</Badge>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-primary" />
                交互回答库
              </div>
              <Tabs
                value={tab}
                onValueChange={(value) => {
                  setPreview(null)
                  setLibraryOpen(true, value as 'saved' | 'templates')
                }}
              >
                <TabsList>
                  <TabsTrigger value="saved">
                    已保存 <span className="font-mono text-[10px] text-muted-foreground">{saved.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="templates">
                    模板 <span className="font-mono text-[10px] text-muted-foreground">{templates.length}</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {preview ? (
            <IntelligentUiWidget spec={preview.spec} initialSavedId={preview.id} />
          ) : tab === 'saved' ? (
            <div className="space-y-1.5">
              {sorted.map((widget) => {
                const meta = TYPE_META[widget.spec.type] || TYPE_META.article
                const Icon = meta.icon
                return (
                  <div
                    key={widget.id}
                    className="flex items-center gap-2.5 rounded-lg border border-border/70 px-2.5 py-2 transition-colors hover:border-border hover:bg-muted/20"
                  >
                    <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
                        <span className="truncate">{widget.title}</span>
                        <Badge variant="secondary">{meta.label}</Badge>
                        {widget.spec.template && <Badge variant="outline">{widget.spec.template}</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground">保存于 {timeText(widget.updatedAt)}</div>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setPreview(widget)}>
                      打开
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="删除"
                      onClick={() => {
                        deleteWidget(widget.id)
                        toast.success('已删除')
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )
              })}
              {!sorted.length && (
                <div className="py-16 text-center text-xs text-muted-foreground">
                  还没有保存的交互回答。聊天里生成后点「保存」就会出现在这里。
                </div>
              )}
            </div>
          ) : (
            <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-[230px_1fr]">
              <div className="space-y-1.5 md:overflow-y-auto">
                <Button type="button" variant="outline" size="sm" className="h-8 w-full justify-center gap-1 text-[11px]" onClick={newTemplate}>
                  <Plus className="size-3" />
                  新建模板
                </Button>
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setDraft(template)}
                    className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      activeDraft?.id === template.id ? 'border-primary bg-accent' : 'border-border/70 hover:bg-muted/30'
                    }`}
                  >
                    <span className="flex shrink-0 -space-x-1">
                      {template.theme.palette.slice(0, 3).map((color, index) => (
                        <span key={color + index} className="size-3 rounded-full border border-card" style={{ background: color }} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{template.name}</span>
                    {template.id === defaultTemplateId && <Star className="size-3 fill-warning text-warning" />}
                  </button>
                ))}
              </div>

              {activeDraft ? (
                <div className="space-y-3 md:overflow-y-auto">
                  <div className="flex flex-wrap gap-1.5">
                    <Button type="button" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={saveTemplate}>
                      <Save className="size-3" />
                      保存模板
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => {
                        setDefaultTemplate(activeDraft.id)
                        toast.success('已设为默认模板')
                      }}
                    >
                      <Star className="size-3" />
                      设为默认
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px] text-destructive"
                      onClick={removeTemplate}
                    >
                      <Trash2 className="size-3" />
                      删除
                    </Button>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">模板名称</label>
                    <Input value={activeDraft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <ColorField label="主色" value={activeDraft.theme.primary} onChange={(value) => updateTheme({ primary: value })} />
                    <ColorField label="强调色" value={activeDraft.theme.accent} onChange={(value) => updateTheme({ accent: value })} />
                    <ColorField label="背景" value={activeDraft.theme.background} onChange={(value) => updateTheme({ background: value })} />
                    <ColorField label="文字" value={activeDraft.theme.foreground} onChange={(value) => updateTheme({ foreground: value })} />
                    <ColorField label="弱背景" value={activeDraft.theme.muted} onChange={(value) => updateTheme({ muted: value })} />
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">圆角 (px)</label>
                      <Input
                        type="number"
                        value={activeDraft.theme.radius}
                        onChange={(event) => updateTheme({ radius: Number(event.target.value) || 0 })}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">图表色板（逗号分隔）</label>
                    <Input
                      value={activeDraft.theme.palette.join(', ')}
                      onChange={(event) =>
                        updateTheme({
                          palette: event.target.value
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">字体</label>
                    <Input value={activeDraft.theme.fontFamily} onChange={(event) => updateTheme({ fontFamily: event.target.value })} />
                  </div>

                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Palette className="size-3" />
                      预览
                    </div>
                    <div
                      className="rounded-lg p-3"
                      style={{
                        background: activeDraft.theme.background,
                        color: activeDraft.theme.foreground,
                        fontFamily: activeDraft.theme.fontFamily,
                        borderRadius: activeDraft.theme.radius,
                      }}
                    >
                      <div className="text-[13px] font-semibold">{activeDraft.name}</div>
                      <div className="mt-1 text-[11px] opacity-70">主色 / 强调色 / 圆角 / 字体预览</div>
                      <div className="mt-2 flex gap-1.5">
                        {activeDraft.theme.palette.slice(0, 5).map((color) => (
                          <span key={color} className="h-6 flex-1 rounded-md" style={{ background: color }} />
                        ))}
                      </div>
                      <button
                        type="button"
                        className="mt-2 rounded-lg px-3 py-1.5 text-[11px] text-white"
                        style={{ background: activeDraft.theme.primary, borderRadius: Math.max(6, activeDraft.theme.radius / 2) }}
                      >
                        主按钮
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-10 text-center text-xs text-muted-foreground">还没有模板</div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-muted-foreground">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="size-8 shrink-0 cursor-pointer rounded-md border border-border bg-card p-0.5"
        />
        <Input value={value} onChange={(event) => onChange(event.target.value)} className="h-8 font-mono text-[11px]" />
      </div>
    </div>
  )
}
