import * as React from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void fetch('/api/log', {
      method: 'POST',
      body: '[react crash] ' + error.message + '\n' + (error.stack || '') + '\n' + (info.componentStack || ''),
    }).catch(() => undefined)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-6 rounded-xl border border-[#f3d0d0] bg-[#fdf4f4] p-4 text-xs text-[#8f2d2d]">
          <div className="mb-2 text-sm font-semibold">React 渲染失败</div>
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">{this.state.error.stack || this.state.error.message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}
