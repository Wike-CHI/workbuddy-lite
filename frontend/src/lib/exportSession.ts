import type { ChatMessage } from '@/lib/types'

interface Meta {
  title: string
  workspace: string
  model: string
  createdAt?: number
}

function partText(part: ChatMessage['parts'][number]): string {
  if (!part || typeof part !== 'object') return ''
  const anyPart = part as Record<string, any>
  switch (anyPart.type) {
    case 'text':
      return String(anyPart.text || '')
    case 'reasoning':
      return ''
    case 'tool-call': {
      const name = anyPart.toolName || 'tool'
      const status = anyPart.artifact?.status ? ` · ${anyPart.artifact.status}` : ''
      return `\n> 工具调用：${name}${status}\n`
    }
    case 'data-plan': {
      const entries = Array.isArray(anyPart.data?.entries) ? anyPart.data.entries : []
      return '\n' + entries.map((e: any) => `- [${e.status === 'completed' ? 'x' : ' '}] ${e.content}`).join('\n') + '\n'
    }
    case 'data-usage':
      return ''
    case 'data-error':
      return `\n> 错误：${anyPart.data?.message || ''}\n`
    default:
      return ''
  }
}

export function sessionToMarkdown(messages: ChatMessage[], meta: Meta) {
  const lines: string[] = []
  lines.push(`# ${meta.title || '会话'}`)
  lines.push('')
  if (meta.workspace) lines.push(`- 工作空间：${meta.workspace}`)
  if (meta.model) lines.push(`- 模型：${meta.model}`)
  if (meta.createdAt) lines.push(`- 导出时间：${new Date(meta.createdAt).toLocaleString()}`)
  lines.push('')
  for (const message of messages) {
    if (message.role === 'user') {
      lines.push('---')
      lines.push('')
      lines.push('**你**')
      lines.push('')
      lines.push(message.parts.map(partText).join('').trim() || '（图片/附件）')
      lines.push('')
    } else {
      const body = message.parts.map(partText).join('').trim()
      if (!body) continue
      lines.push('**助手**')
      lines.push('')
      lines.push(body)
      lines.push('')
    }
  }
  return lines.join('\n')
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function sessionToHtml(markdown: string, title: string) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:#f6f7f9;color:#1f2328;font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:820px;margin:0 auto;padding:40px 24px 80px;background:#fff;min-height:100vh;box-sizing:border-box}
pre{white-space:pre-wrap;word-break:break-word;font:13px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;background:#f6f8fa;padding:16px;border-radius:10px}
</style></head>
<body><main><pre>${escapeHtml(markdown)}</pre></main></body></html>`
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function safeFileName(name: string) {
  return (name || 'session').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)
}
