import { Loader2, RefreshCw, Sparkles, Wand2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useChatStore } from '@/store/chat'

interface ProjectProposal {
  cwd: string
  name: string
}

interface SessionProposal {
  id: string
  title: string
  include: boolean
}

export function ProjectAiDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const sessions = useChatStore((s) => s.sessions)
  const refreshSessions = useChatStore((s) => s.refreshSessions)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [projects, setProjects] = React.useState<ProjectProposal[]>([])
  const [proposals, setProposals] = React.useState<SessionProposal[]>([])

  const titleOf = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const session of sessions) map.set(session.id, session.title || '新会话')
    return map
  }, [sessions])

  const run = async () => {
    setLoading(true)
    setError('')
    setProjects([])
    setProposals([])
    try {
      const res = await api.aiOrganize()
      if (!res.ok) throw new Error(res.error || 'AI 整理失败')
      setProjects(res.projects || [])
      setProposals((res.sessions || []).map((s) => ({ ...s, include: true })))
      if (!(res.projects || []).length && !(res.sessions || []).length) {
        setError('模型没有给出需要调整的项目或会话')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    if (open) void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const apply = async () => {
    const nextProjects = projects
      .map((p) => ({ path: p.cwd, name: p.name.trim() }))
      .filter((p) => p.path && p.name)
    const nextSessions = proposals.filter((s) => s.include && s.title.trim()).map((s) => ({ id: s.id, title: s.title.trim() }))
    if (!nextProjects.length && !nextSessions.length) {
      toast.warning('没有勾选要应用的内容')
      return
    }
    try {
      const res = await api.applyProjects(nextProjects, nextSessions)
      if (!res.ok) throw new Error(res.error || '应用失败')
      toast.success(`已更新 ${res.projects} 个项目名、${res.sessions} 个会话标题`)
      await refreshSessions()
      onOpenChange(false)
    } catch (err) {
      toast.error('应用失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const included = proposals.filter((s) => s.include && s.title.trim()).length + projects.filter((p) => p.name.trim()).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(780px,calc(100vh-50px))] w-[min(820px,calc(100vw-40px))] max-w-none">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5 pr-12">
          <Wand2 className="size-4 text-primary" />
          <span className="text-sm font-semibold">AI 整理项目与会话</span>
          <span className="text-[10.5px] text-muted-foreground">让 CodeBuddy 优化项目名和会话标题</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-16 text-xs text-muted-foreground">
              <Loader2 className="size-6 animate-spin text-primary" />
              CodeBuddy 正在分析 {sessions.length} 个会话…
            </div>
          )}
          {!loading && error && (
            <div className="space-y-3">
              <div className="rounded-xl border border-[#f3d0d0] bg-[#fdf4f4] p-3 text-xs text-[#8f2d2d]">{error}</div>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void run()}>
                <RefreshCw className="size-3.5" />
                重新分析
              </Button>
            </div>
          )}
          {!loading && !error && (
            <div className="space-y-4">
              <section>
                <h3 className="mb-1.5 text-[10.5px] font-medium tracking-wide text-muted-foreground">项目名</h3>
                {!projects.length && <div className="py-2 text-xs text-muted-foreground">没有项目名调整建议</div>}
                {projects.map((project, index) => (
                  <div key={project.cwd} className="mb-1.5 flex items-center gap-2 rounded-lg border border-border/70 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground" title={project.cwd}>
                      {project.cwd}
                    </span>
                    <Input
                      value={project.name}
                      onChange={(event) =>
                        setProjects((prev) => prev.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))
                      }
                      className="h-7 w-[180px] text-xs"
                    />
                  </div>
                ))}
              </section>

              <section>
                <h3 className="mb-1.5 text-[10.5px] font-medium tracking-wide text-muted-foreground">会话标题</h3>
                {!proposals.length && <div className="py-2 text-xs text-muted-foreground">没有会话标题调整建议</div>}
                {proposals.map((proposal, index) => (
                  <div key={proposal.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-border/70 px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={proposal.include}
                      onChange={(event) =>
                        setProposals((prev) => prev.map((item, i) => (i === index ? { ...item, include: event.target.checked } : item)))
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={titleOf.get(proposal.id) || proposal.id}>
                      {titleOf.get(proposal.id) || proposal.id}
                    </span>
                    <Input
                      value={proposal.title}
                      onChange={(event) =>
                        setProposals((prev) => prev.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))
                      }
                      className="h-7 w-[220px] text-xs"
                    />
                  </div>
                ))}
              </section>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <span className="text-[10.5px] text-muted-foreground">
            {loading ? '分析中…' : `将应用 ${included} 项更改`}
          </span>
          <div className="flex gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => void run()} disabled={loading}>
              <RefreshCw className="size-3.5" />
              重新分析
            </Button>
            <Button type="button" size="sm" className="gap-1.5" onClick={() => void apply()} disabled={loading || included === 0}>
              <Sparkles className="size-3.5" />
              应用
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
