import { Command as CommandPrimitive } from 'cmdk'
import { Search } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn('flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground', className)}
      {...props}
    />
  )
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3" cmdk-input-wrapper="">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        className={cn(
          'flex h-9 w-full rounded-md bg-transparent py-2 text-xs outline-none placeholder:text-muted-foreground disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn('max-h-[320px] overflow-y-auto overflow-x-hidden p-1', className)} {...props} />
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-6 text-center text-xs text-muted-foreground" {...props} />
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn('overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-muted-foreground', className)}
      {...props}
    />
  )
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-start gap-2 rounded-lg px-2 py-1.5 text-xs outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator className={cn('-mx-1 h-px bg-border', className)} {...props} />
}

function CommandShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('ml-auto text-[10px] tracking-widest text-muted-foreground', className)} {...props} />
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
