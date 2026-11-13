import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary',
        secondary: 'bg-muted text-muted-foreground',
        outline: 'border-border text-muted-foreground',
        success: 'bg-[#eaf7f0] text-[#1a9f60]',
        warning: 'bg-warning-soft text-warning',
        destructive: 'bg-[#fdeeee] text-destructive',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
)

function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
