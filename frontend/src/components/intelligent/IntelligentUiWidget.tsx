import {
  BarChart3,
  ClipboardList,
  FileDown,
  FileText,
  ImageDown,
  Map as MapIcon,
  Pencil,
  Save,
  Sparkles,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  downloadDataUrl,
  exportWidgetPage,
  safeFileName,
} from '@/lib/widgetExport'
import { resolveTheme, useIntelligentUiStore } from '@/store/intelligentUi'
import type { VisualTheme, WidgetKind, WidgetSpec } from '@/lib/types'
import { ArticleWidget } from './ArticleWidget'
import { ChartWidget } from './ChartWidget'
import { FormWidget } from './FormWidget'
import type { WidgetHandle } from './handle'
import { MapWidget } from './MapWidget'

const TYPE_META: Record<WidgetKind, { label: string; icon: typeof BarChart3 }> = {
  chart: { label: '图表', icon: BarChart3 },
  map: { label: '地图', icon: MapIcon },
  form: { label: '表单', icon: ClipboardList },
  article: { label: '文章', icon: FileText },
}

export function IntelligentUiWidget({
  spec,
  compact = false,
  initialSavedId,
}: {
  spec: WidgetSpec
  compact?: boolean
  initialSavedId?: string
}) {
  const templates = useIntelligentUiStore((s) => s.templates)
  const defaultTemplateId = useIntelligentUiStore((s) => s.defaultTemplateId)
  const saveWidget = useIntelligentUiStore((s) => s.saveWidget)
  const [current, setCurrent] = React.useState<WidgetSpec>(spec)
  const [savedId, setSavedId] = React.useState<string | undefined>(initialSavedId)
  const [adjustOpen, setAdjustOpen] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const handleRef = React.useRef<WidgetHandle>(null)

  React.useEffect(() => {
    setCurrent(spec)
    setSavedId(initialSavedId)
  }, [spec, initialSavedId])

  const theme = React.useMemo(
    () => resolveTheme(current, templates, defaultTemplateId),
    [current, templates, defaultTemplateId],
  )
  const meta = TYPE_META[current.type] || TYPE_META.article
  const Icon = meta.icon

  const update = (patch: Partial<WidgetSpec>) => {
    setCurrent((prev) => ({ ...prev, ...patch }))
  }

  const save = () => {
    const saved = saveWidget(current, savedId)
    setSavedId(saved.id)
    toast.success('已保存到交互回答库')
  }

  const exportImage = async () => {
    try {
      const data = await handleRef.current?.exportImage()
      if (!data) {
        toast.error('当前组件暂时不能导出图片')
        return
      }
      downloadDataUrl(safeFileName(current.title, 'png'), data)
      toast.success('已导出 PNG')
    } catch (error) {
      toast.error('导出图片失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  const exportPage = async () => {
    try {
      await exportWidgetPage(current, theme)
      toast.success('已导出交互页面')
    } catch (error) {
      toast.error('导出页面失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  const openAdjust = () => {
    setDraft(JSON.stringify(current, null, 2))
    setAdjustOpen(true)
  }

  const applyAdjust = () => {
    try {
      const parsed = JSON.parse(draft) as WidgetSpec
      if (!parsed || typeof parsed !== 'object' || !parsed.type) throw new Error('JSON 缺少 type 字段')
      setCurrent(parsed)
      if (savedId) saveWidget(parsed, savedId)
      setAdjustOpen(false)
      toast.success('已应用调整')
    } catch (error) {
      toast.error('JSON 不合法：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      style={{ fontFamily: theme.fontFamily }}
    >
      <div
        className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2"
        style={{ background: theme.muted, color: theme.foreground }}
      >
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg"
          style={{ background: theme.background, color: theme.primary }}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-semibold">{current.title || meta.label}</span>
            <Badge variant="secondary">{meta.label}</Badge>
          </div>
          {current.subtitle && <div className="truncate text-[10.5px] opacity-70">{current.subtitle}</div>}
        </div>
        <div className="flex items-center gap-1">
          <Select
            value={current.template || defaultTemplateId}
            onValueChange={(value) => update({ template: value })}
          >
            <SelectTrigger className="h-7 w-[112px] text-[11px]" title="视觉模板">
              <SelectValue placeholder="模板" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="ghost" size="icon-sm" title="调整 JSON" onClick={openAdjust}>
            <Pencil className="size-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" title="保存到交互回答库" onClick={save}>
            <Save className="size-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" title="导出 PNG" onClick={() => void exportImage()}>
            <ImageDown className="size-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" title="导出交互页面" onClick={() => void exportPage()}>
            <FileDown className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className={compact ? 'p-2' : 'p-3'} style={{ background: theme.background, color: theme.foreground }}>
        <WidgetBody spec={current} theme={theme} handleRef={handleRef} />
      </div>

      <div className="flex items-center justify-between border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Sparkles className="size-2.5" />
          临时结果 · 可直接使用 / 调整 / 保存 / 导出
        </span>
        <button type="button" className="font-mono hover:text-foreground" onClick={openAdjust}>
          JSON
        </button>
      </div>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-[760px]">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 pr-12">
            <Pencil className="size-3.5 text-muted-foreground" />
            <span className="text-sm font-semibold">调整交互回答</span>
            <span className="text-[10.5px] text-muted-foreground">改 JSON，应用后立即重渲染</span>
          </div>
          <div className="p-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="h-[52vh] resize-none font-mono text-[11.5px] leading-5"
              spellCheck={false}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-4 py-2.5">
            <Button type="button" variant="outline" size="sm" onClick={() => setAdjustOpen(false)}>
              取消
            </Button>
            <Button type="button" size="sm" onClick={applyAdjust}>
              应用
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function WidgetBody({
  spec,
  theme,
  handleRef,
}: {
  spec: WidgetSpec
  theme: VisualTheme
  handleRef: React.RefObject<WidgetHandle | null>
}) {
  if (spec.type === 'chart') return <ChartWidget ref={handleRef} spec={spec} theme={theme} />
  if (spec.type === 'map') return <MapWidget ref={handleRef} spec={spec} theme={theme} />
  if (spec.type === 'form') return <FormWidget ref={handleRef} spec={spec} theme={theme} />
  if (spec.type === 'article') return <ArticleWidget ref={handleRef} spec={spec} theme={theme} />
  return <div className="rounded-xl border border-[#f3d0d0] bg-[#fdf4f4] p-3 text-xs text-[#8f2d2d]">未知组件类型</div>
}
