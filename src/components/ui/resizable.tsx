"use client"

import { GripVerticalIcon } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

/**
 * ResizableHandle wraps the library's Separator.
 *
 * CRITICAL: Do NOT set w-* or width CSS classes on the Separator element.
 * The library controls separator sizing via inline styles (flexBasis, flexGrow, flexShrink).
 * CSS width classes conflict with the drag calculation and cause collapse-to-zero bugs.
 * Use the `style` prop with flexBasis to set separator thickness instead.
 */
function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex items-center justify-center bg-border/40 transition-colors hover:bg-border/80 active:bg-primary/20 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      style={{ flexBasis: "6px" }}
      {...props}
    >
      {withHandle && (
        <div className="absolute z-10 flex h-8 w-4 items-center justify-center rounded-sm border bg-background shadow-sm cursor-col-resize">
          <GripVerticalIcon className="size-3 text-muted-foreground" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
