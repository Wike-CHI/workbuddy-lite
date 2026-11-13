import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

window.addEventListener('error', (event) => {
  void fetch('/api/log', {
    method: 'POST',
    body: '[page error] ' + event.message + '\n' + (event.error?.stack || ''),
  }).catch(() => undefined)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  void fetch('/api/log', {
    method: 'POST',
    body: '[page rejection] ' + (reason?.stack || reason?.message || String(reason)),
  }).catch(() => undefined)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
