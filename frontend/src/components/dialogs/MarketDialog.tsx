import { useAui } from '@assistant-ui/react'
import { Blocks, RefreshCw, Search, Sparkles, Wrench } from 'lucide-react'
import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PluginMarket } from '@/components/dialogs/PluginMarket'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'
import { useUiStore } from '@/store/ui'
import type { AcpCommand, CatalogSkill } from '@/lib/types'

type Tab = 'skills' | 'connectors' | 'plugins'

function mergeSkills(skills: CatalogSkill[], commands: AcpCommand[]) {
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

function filterBy<T extends { name: string; description?: string }>(items: T[], query: string) {
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

export function MarketDialog() {
  const open = useUiStore((s) => s.marketOpen)
  const setOpen = useUiStore((s) => s.setMarketOpen)
  const catalog = useChatStore((s) => s.catalog)
  const commands = useChatStore((s) => s.commands)
  const loadCatalog = useChatStore((s) => s.loadCatalog)
  const addConnector = useChatStore((s) => s.addConnector)
  const aui = useAui()
  const [tab, setTab] = React.useState<Tab>('skills')
  const [query, setQuery] = React.useState('')
  const [pluginCount, setPluginCount] = React.useState<number | null>(null)
  const [marketKey, setMarketKey] = React.useState(0)

  const skills = mergeSkills(catalog.skills, commands)
  const connectors = catalog.connectors

  const filteredSkills = filterBy(skills, query)
  const filteredConnectors = filterBy(connectors, query)

  const insertSkill = (name: string) => {
    const current = aui.composer.getState().text
    const prefix = current && !/\s$/.test(current) ? current + ' ' : current
    aui.composer.setText(prefix + '/' + name + ' ')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="h-[min(680px,calc(100vh-80px))] w-[min(800px,calc(100vw-64px))] max-w-none">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
            <TabsList>
              <TabsTrigger value="skills">
                技能 <span className="font-mono text-[10px] text-muted-foreground">{skills.length}</span>
              </TabsTrigger>
              <TabsTrigger value="connectors">
                连接器 <span className="font-mono text-[10px] text-muted-foreground">{connectors.length}</span>
              </TabsTrigger>
              <TabsTrigger value="plugins" id="market-tab-plugins">
                插件市场{' '}
                <span className="font-mono text-[10px] text-muted-foreground">
                  {pluginCount ?? catalog.plugins.length}
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-1 items-center justify-end gap-1.5">
            <div className="relative w-36">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="筛选…"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              title="重新读取本地配置"
              onClick={() => {
                void loadCatalog()
                if (tab === 'plugins') {
                  setPluginCount(null)
                  setMarketKey((value) => value + 1)
                }
              }}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {tab === 'skills' && (
            <div className="space-y-1.5">
              {filteredSkills.map((skill) => (
                <Row
                  key={skill.name}
                  icon={<Sparkles className="size-3.5" />}
                  title={skill.name}
                  badges={<Badge variant="secondary">{skill.source || '技能'}</Badge>}
                  description={skill.description || '（没有写描述）'}
                  meta={skill.hint ? `参数：${skill.hint}` : ''}
                  action={
                    <Button type="button" size="sm" className="h-7 px-2 text-[11px]" onClick={() => insertSkill(skill.name)}>
                      插入
                    </Button>
                  }
                />
              ))}
              {!filteredSkills.length && <Empty text="还没有发现技能。项目或用户目录下的 SKILL.md 会被识别。" />}
            </div>
          )}

          {tab === 'connectors' && (
            <div className="space-y-1.5">
              {filteredConnectors.map((connector) => (
                <Row
                  key={connector.name}
                  icon={<Wrench className="size-3.5" />}
                  title={connector.name}
                  badges={
                    <>
                      <Badge variant="secondary">{connector.type || 'stdio'}</Badge>
                      <Badge variant="secondary">{connector.scope || 'user'}</Badge>
                      <Badge variant={connector.disabled ? 'warning' : 'success'}>
                        {connector.disabled ? '已停用' : '可用'}
                      </Badge>
                    </>
                  }
                  description={[connector.target, ...(connector.args || [])].filter(Boolean).join(' ')}
                  meta={connector.configPath || ''}
                  action={
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      disabled={connector.disabled}
                      onClick={() => {
                        addConnector(connector.name)
                        setOpen(false)
                      }}
                    >
                      引用
                    </Button>
                  }
                />
              ))}
              {!filteredConnectors.length && (
                <Empty text="还没有连接器。在 .codebuddy/mcp.json 或项目 .mcp.json 里配置 mcpServers 后刷新。" />
              )}
            </div>
          )}

          {tab === 'plugins' && (
            <PluginMarket key={marketKey} query={query} onCount={setPluginCount} />
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <Blocks className="size-3" />
          <span>配置目录</span>
          <span className="truncate font-mono">{catalog.codebuddyDir || '—'}</span>
          <span className="flex-1" />
          <span>插件安装/卸载调用 codebuddy CLI，状态直接读 CLI 配置</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({
  icon,
  title,
  badges,
  description,
  meta,
  action,
}: {
  icon: React.ReactNode
  title: string
  badges: React.ReactNode
  description: string
  meta: string
  action: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border/70 px-2.5 py-2 transition-colors hover:border-border hover:bg-muted/20">
      <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium">
          <span className="truncate">{title}</span>
          {badges}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{description}</div>
        {meta && <div className="truncate font-mono text-[10px] text-muted-foreground/80">{meta}</div>}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className={cn('py-10 text-center text-xs text-muted-foreground')}>{text}</div>
}
