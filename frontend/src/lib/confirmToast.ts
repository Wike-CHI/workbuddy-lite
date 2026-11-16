import { toast } from 'sonner'

// 统一用 toast 做二次确认，避免系统对话框打断界面
export function confirmToast(options: {
  title: string
  description?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
}) {
  toast(options.title, {
    description: options.description,
    duration: 10000,
    action: {
      label: options.confirmLabel || '确认',
      onClick: () => void options.onConfirm(),
    },
    cancel: {
      label: '取消',
      onClick: () => undefined,
    },
    actionButtonStyle: options.danger ? { background: '#cf222e', color: '#ffffff' } : undefined,
    cancelButtonStyle: { background: 'transparent' },
  })
}
