import type * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-16 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
