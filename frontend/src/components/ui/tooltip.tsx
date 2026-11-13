import { Tooltip as TooltipPrimitive } from 'radix-ui'
import type * as React from 'react'

import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-[70] max-w-72 rounded-lg bg-[#1f2329] px-2.5 py-1.5 text-[11px] leading-5 text-white shadow-md animate-in fade-in-0 zoom-in-95',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
