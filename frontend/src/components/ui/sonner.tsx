import { Toaster as Sonner, type ToasterProps } from 'sonner'

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: 'rounded-xl border border-border bg-card text-foreground shadow-lg',
          description: 'text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
