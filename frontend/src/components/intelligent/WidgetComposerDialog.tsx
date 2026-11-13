import { BarChart3, ClipboardList, FileText, Map as MapIcon, Sparkles } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useIntelligentUiStore } from '@/store/intelligentUi'
import { cn } from '@/lib/utils'
import type { WidgetKind } from '@/lib/types'

const TYPES: { kind: WidgetKind; label: string; icon: typeof BarChart3; hint: string }[] = [
  { kind: 'chart', label: '图表', icon: BarChart3, hint: '柱状 / 折线 / 面积 / 饼图' },
  { kind: 'map', label: '地图', icon: MapIcon, hint: '世界底图 / 自定义 GeoJSON + 标记' },
  { kind: 'form', label: '表单', icon: ClipboardList, hint: '输入 / 选择 / 提交' },
  { kind: 'article', label: '文章', icon: FileText, hint: '结构化长文 / 图文' },
]

const SCHEMA: Record<WidgetKind, string> = {
  chart: `{"type":"chart","title":"标题","subtitle":"副标题","template":"blue","chart":{"kind":"bar","categories":["A","B","C"],"series":[{"name":"系列1","data":[12,28,19]}],"unit":"","showLegend":true,"showValues":true}}`,
  map: `{"type":"map","title":"标题","template":"blue","map":{"markers":[{"name":"北京","lng":116.4,"lat":39.9,"value":10,"description":"示例"}],"zoom":1.2}}`,
  form: `{"type":"form","title":"标题","template":"blue","form":{"fields":[{"id":"name","label":"姓名","type":"text","placeholder":"请输入","required":true},{"id":"type","label":"类型","type":"select","options":[{"label":"选项 A","value":"a"},{"label":"选项 B","value":"b"}]},{"id":"note","label":"备注","type":"textarea"}],"submitLabel":"提交","successMessage":"已提交"}}`,
  article: `{"type":"article","title":"标题","subtitle":"副标题","template":"blue","article":{"markdown":"## 小标题\\n\\n正文段落，支持 **Markdown**、列表和引用。","tags":["标签一","标签二"]}}`,
}

export function WidgetComposerDialog({
  open,
  onOpenChange,
  onGenerate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerate: (prompt: string, sendNow: boolean) => void
}) {
  const templates = useIntelligentUiStore((s) => s.templates)
  const defaultTemplateId = useIntelligentUiStore((s) => s.defaultTemplateId)
  const [kind, setKind] = React.useState<WidgetKind>('chart')
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [template, setTemplate] = React.useState(defaultTemplateId)

  const buildPrompt = () => {
    const templateName = templates.find((t) => t.id === template)?.name || template
    return [
      '请生成一个 intelligent-ui 交互回答。',
      '',
      `类型：${kind}`,
      `标题：${title || '由你根据内容决定'}`,
      `视觉模板：${template}（${templateName}）`,
      `需求：${description || '根据当前对话上下文生成一个合适的内容'}`,
      '',
      '只输出一个 ```iui 代码块，代码块里是合法 JSON，不要输出解释、不要用其他语言标记。',
      'JSON 结构示例：',
      '```iui',
      SCHEMA[kind],
      '```',
      '',
      '要求：数据要具体、可交互；如果缺少真实数据，可以用合理的示例数据填充并在 subtitle 里说明。',
      kind === 'map'
        ? '地图可选传 map.geojson：FeatureCollection 对象、GeoJSON 字符串，或 GeoJSON 地址（如 /maps/wenzhou.json），用于替换世界底图。'
        : '',
    ].join('\n')
  }

  const generate = (sendNow: boolean) => {
    if (!description.trim() && !title.trim()) {
      toast.warning('至少写一句需求或标题')
      return
    }
    onGenerate(buildPrompt(), sendNow)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px]">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 pr-12">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-semibold">生成交互回答</span>
          <span className="text-[10.5px] text-muted-foreground">地图 / 图表 / 表单 / 文章</span>
        </div>

        <div className="space-y-3.5 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TYPES.map((item) => {
              const Icon = item.icon
              const active = kind === item.kind
              return (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => setKind(item.kind)}
                  className={cn(
                    'rounded-xl border p-2.5 text-left transition-colors',
                    active ? 'border-primary bg-accent text-accent-foreground' : 'border-border hover:bg-muted/40',
                  )}
                >
                  <Icon className={cn('mb-1.5 size-4', active ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="text-[12.5px] font-medium">{item.label}</div>
                  <div className="text-[10px] text-muted-foreground">{item.hint}</div>
                </button>
              )
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">标题（可选）</label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Q4 区域销售分布" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">视觉模板</label>
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">你希望它展示什么？</label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="例如：把下面三个区域的销售额做成柱状图：华东 120 万、华南 86 万、华北 95 万。"
              className="min-h-24 text-[12.5px]"
            />
          </div>

          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[10.5px] leading-5 text-muted-foreground">
            CodeBuddy 会返回一个 <code className="rounded bg-card px-1">```iui</code> JSON 块，聊天里会直接渲染成可交互组件；
            生成后可以调整 JSON、保存到交互回答库，或导出 PNG / 独立 HTML 页面。
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-2.5">
          <Button type="button" variant="outline" size="sm" onClick={() => generate(false)}>
            填入输入框
          </Button>
          <Button type="button" size="sm" className="gap-1.5" onClick={() => generate(true)}>
            <Sparkles className="size-3.5" />
            生成并发送
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
