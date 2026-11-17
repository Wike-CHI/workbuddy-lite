import * as React from 'react'

import { cn } from '@/lib/utils'

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type Token = string | { mention: string }

function tokenize(text: string, names: string[]): Token[] {
  if (!names.length) return [text]
  const sorted = [...names].sort((a, b) => b.length - a.length).map(escapeRegExp)
  const regex = new RegExp(`@(?:${sorted.join('|')}|all|所有智能体)`, 'g')
  const tokens: Token[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    if (match.index > last) tokens.push(text.slice(last, match.index))
    tokens.push({ mention: match[0].slice(1) })
    last = match.index + match[0].length
  }
  if (last < text.length) tokens.push(text.slice(last))
  return tokens
}

function renderText(text: string, names: string[], chipClass: string) {
  return tokenize(text, names).map((token, index) => {
    if (typeof token === 'string') return <React.Fragment key={index}>{token}</React.Fragment>
    return (
      <span
        key={index}
        className={cn(
          'mx-0.5 inline-flex max-w-full items-center rounded-[4px] px-1 align-baseline text-[12.5px]',
          chipClass,
        )}
      >
        @{token.mention}
      </span>
    )
  })
}

// 成员名来自 state，消息里的 @名字 是纯文本；这里做「文本 → @芯片」的轻量替换，
// 不引入 contenteditable，也不改写原始消息。
export function renderMentions(
  node: React.ReactNode,
  names: string[],
  chipClass = 'bg-surface-3 text-ink-2',
): React.ReactNode {
  if (typeof node === 'string') return <>{renderText(node, names, chipClass)}</>
  if (typeof node === 'number') return node
  if (Array.isArray(node)) {
    return node.map((item, index) => (
      <React.Fragment key={index}>{renderMentions(item, names, chipClass)}</React.Fragment>
    ))
  }
  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>
    if (element.props.children === undefined) return element
    return React.cloneElement(
      element,
      {},
      renderMentions(element.props.children, names, chipClass),
    )
  }
  return node
}

export function mentionNames(agents: { name: string }[]) {
  return agents.map((agent) => agent.name).filter(Boolean)
}
