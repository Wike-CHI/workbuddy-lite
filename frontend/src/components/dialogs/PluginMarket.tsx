import { ArrowDownToLine, Blocks, Link2, Loader2, PackagePlus, RefreshCw, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { MarketInfo, MarketJob, MarketOverview, MarketPlugin } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function revealMarket(name: string) {
  setTimeout(() => {
    document.getElementById(`market-group-${name}`)?.scrollIntoView({ block: 'start' })
  }, 250)
}

async function waitForJob(id: string): Promise<MarketJob> {
  const deadline = Date.now() + 200_000
  for (;;) {
    const { job } = await api.marketJob(id)
    if (job.status !== 'running') return job
    if (Date.now() > deadline) throw new Error('等待 CLI 任务超时，请稍后刷新市场查看结果')
    await sleep(600)
  }
}

function matches(plugin: MarketPlugin, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${plugin.name} ${plugin.description || ''} ${plugin.category || ''} ${plugin.marketplace}`
    .toLowerCase()
    .includes(q)
}

export function PluginMarket({ query, onCount }: { query: string; onCount?: (count: number) => void }) {
  const loadCatalog = useChatStore((s) => s.loadCatalog)
  const [overview, setOverview] = React.useState<MarketOverview | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [url, setUrl] = React.useState('')
  const [parsing, setParsing] = React.useState(false)
  const [busyKey, setBusyKey] = React.useState('')
  const [error, setError] = React.useState('')

  const refresh = React.useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setLoading(true)
      try {
        const data = await api.marketOverview()
        setOverview(data)
        setError('')
        onCount?.(data.totals?.plugins || data.plugins.length)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        if (silent) toast.error('刷新插件市场失败', { description: msg })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [onCount],
  )

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const reloadAll = async () => {
    await refresh(true)
    await loadCatalog()
  }

  const parse = async () => {
    const target = url.trim()
    if (!target) {
      toast.error('请先填写插件市场地址')
      return
    }
    setParsing(true)
    try {
      const { job } = await api.parseMarket(target)
      const done = await waitForJob(job.id)
      if (done.status !== 'ok' || !done.result) throw new Error(done.error || '解析失败')
      const result = done.result
      toast.success(result.added ? '已添加插件市场' : '已刷新插件市场', {
        description: `${result.marketplace.name} · ${result.plugins.length} 个插件${result.warning ? ` · ${result.warning}` : ''}`,
      })
      setUrl('')
      await reloadAll()
      if (result.marketplace?.name) revealMarket(result.marketplace.name)
    } catch (e) {
      toast.error('解析失败', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setParsing(false)
    }
  }

  const run = async (action: 'install' | 'uninstall', plugin: MarketPlugin) => {
    setBusyKey(plugin.key)
    try {
      const { job } =
        action === 'install'
          ? await api.installPlugin(plugin.name, plugin.marketplace)
          : await api.uninstallPlugin(plugin.name, plugin.marketplace)
      const done = await waitForJob(job.id)
      if (done.status !== 'ok') throw new Error(done.error || 'CLI 没有返回成功状态')
      toast.success(action === 'install' ? '插件已安装' : '插件已卸载', {
        description: `${plugin.name}@${plugin.marketplace}`,
      })
      await reloadAll()
      revealMarket(plugin.marketplace)
    } catch (e) {
      toast.error(action === 'install' ? '安装失败' : '卸载失败', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusyKey('')
    }
  }

  const groups = React.useMemo(() => {
    if (!overview) return []
    const q = query.trim().toLowerCase()
    const byMarket = new Map<string, MarketPlugin[]>()
    for (const p of overview.plugins) {
      const list = byMarket.get(p.marketplace) || []
      list.push(p)
      byMarket.set(p.marketplace, list)
    }
    return overview.marketplaces
      .map((market) => {
        const all = (byMarket.get(market.name) || []).sort(
          (a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name),
        )
        const marketHit =
          !!q &&
          `${market.name} ${market.description || ''} ${market.source || ''}`.toLowerCase().includes(q)
        const items = marketHit ? all : all.filter((p) => matches(p, query))
        return { market, all, items }
      })
      .filter((g) => (q ? g.items.length > 0 : g.all.length > 0))
  }, [overview, query])

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-3 -mt-2 border-b border-border/70 bg-card px-3 py-2.5 before:absolute before:-top-2 before:left-0 before:right-0 before:h-2 before:bg-card before:content-['']">
        <div className="flex items-center gap-2">
          <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            id="market-url-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void parse()
            }}
            placeholder="粘贴 marketplace 地址，例如 https://github.com/acme/team-utils"
            className="h-8 flex-1 font-mono text-[11px]"
            disabled={parsing}
          />
          <Button
            id="market-parse-btn"
            type="button"
            size="sm"
            className="h-8 px-2.5 text-[11px]"
            disabled={parsing || !url.trim()}
            onClick={() => void parse()}
          >
            {parsing ? <Loader2 className="size-3 animate-spin" /> : <PackagePlus className="size-3" />}
            {parsing ? '解析中' : '解析市场'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            title="刷新市场与本地 catalog"
            disabled={refreshing || busyKey !== ''}
            onClick={() => void reloadAll()}
          >
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          </Button>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span>解析走 codebuddy plugin marketplace add；解析后可逐个安装</span>
          <span className="flex-1" />
          {overview?.demo && <Badge variant="warning">演示数据</Badge>}
          {overview?.cli && <span className="font-mono">{overview.cli}</span>}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          正在读取 codebuddy 插件市场…
        </div>
      ) : (
        <>
          {overview && (
            <div className="flex items-center gap-2 px-0.5 text-[10.5px] text-muted-foreground">
              <span className="font-mono">{overview.totals.marketplaces}</span>
              <span>个市场</span>
              <span className="text-border">/</span>
              <span>已安装</span>
              <span className="font-mono text-foreground">{overview.totals.installed}</span>
              <span className="text-border">/</span>
              <span>可安装</span>
              <span className="font-mono">{overview.totals.available}</span>
              {overview.codebuddyDir && (
                <>
                  <span className="flex-1" />
                  <span className="truncate font-mono" title={overview.codebuddyDir}>
                    {overview.codebuddyDir}
                  </span>
                </>
              )}
            </div>
          )}

          {!groups.length && (
            <div className="py-12 text-center text-xs text-muted-foreground">
              {query ? '没有匹配的插件。' : '还没有市场。粘贴一个 marketplace 地址开始解析。'}
            </div>
          )}

          {groups.map(({ market, items }) => {
            const installed = items.filter((p) => p.installed)
            const available = items.filter((p) => !p.installed)
            return (
              <MarketGroup
                key={market.name}
                market={market}
                installed={installed}
                available={available}
                busyKey={busyKey}
                onAction={run}
              />
            )
          })}
        </>
      )}
    </div>
  )
}

function MarketGroup({
  market,
  installed,
  available,
  busyKey,
  onAction,
}: {
  market: MarketInfo
  installed: MarketPlugin[]
  available: MarketPlugin[]
  busyKey: string
  onAction: (action: 'install' | 'uninstall', plugin: MarketPlugin) => void
}) {
  return (
    <section
      id={`market-group-${market.name}`}
      className="scroll-mt-20 overflow-hidden rounded-lg border border-border/70"
    >
      <div className="flex items-start gap-2 border-b border-border/60 bg-surface-2/50 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium">
            <span className="truncate">{market.name}</span>
            {market.builtIn && <Badge variant="secondary">内置</Badge>}
            {market.type && <Badge variant="outline">{market.type}</Badge>}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {market.description || '（市场里没写描述）'}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground/80" title={market.source}>
            {market.source || '—'}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] text-muted-foreground">
            已装 <span className="font-mono text-foreground">{market.installedCount}</span> / 可装{' '}
            <span className="font-mono text-foreground">{market.availableCount}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">共 {market.pluginCount} 个插件</div>
        </div>
      </div>

      {installed.length > 0 && (
        <>
          <StatusLabel label="已安装" count={installed.length} />
          {installed.map((plugin) => (
            <PluginRow key={plugin.key} plugin={plugin} busy={busyKey === plugin.key} onAction={onAction} />
          ))}
        </>
      )}
      {available.length > 0 && (
        <>
          <StatusLabel label="可安装" count={available.length} />
          {available.map((plugin) => (
            <PluginRow key={plugin.key} plugin={plugin} busy={busyKey === plugin.key} onAction={onAction} />
          ))}
        </>
      )}
      {!installed.length && !available.length && (
        <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">该市场没有可展示的插件。</div>
      )}
    </section>
  )
}

function StatusLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] tracking-wide text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono">{count}</span>
      <span className="h-px flex-1 bg-border/60" />
    </div>
  )
}

function PluginRow({
  plugin,
  busy,
  onAction,
}: {
  plugin: MarketPlugin
  busy: boolean
  onAction: (action: 'install' | 'uninstall', plugin: MarketPlugin) => void
}) {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 transition-colors hover:bg-muted/20">
      <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Blocks className="size-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium">
          <span className="truncate">{plugin.name}</span>
          {plugin.installed && plugin.enabled && <Badge variant="success">已启用</Badge>}
          {plugin.version && <Badge variant="secondary">v{plugin.version}</Badge>}
          {plugin.category && <Badge variant="outline">{plugin.category}</Badge>}
        </div>
        <div className="line-clamp-2 text-[11px] leading-5 text-muted-foreground">
          {plugin.description || '（市场里没写描述）'}
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground/80" title={plugin.key}>
          {plugin.key}
          {plugin.installed && plugin.scope ? ` · ${plugin.scope}` : ''}
        </div>
      </div>
      <div className="shrink-0 self-center">
        {plugin.installed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            data-plugin-key={plugin.key}
            data-market-action="uninstall"
            disabled={busy}
            onClick={() => onAction('uninstall', plugin)}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
            {busy ? '卸载中' : '卸载'}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-[11px]"
            data-plugin-key={plugin.key}
            data-market-action="install"
            disabled={busy}
            onClick={() => onAction('install', plugin)}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <ArrowDownToLine className="size-3" />}
            {busy ? '安装中' : '安装'}
          </Button>
        )}
      </div>
    </div>
  )
}
