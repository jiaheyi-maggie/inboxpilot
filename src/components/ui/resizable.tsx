"use client"

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
 *
 * Design: 8px invisible hit area with a 1px centered line. Hover/active show
 * a subtle primary tint. No grip icon — clean, modern look (Linear/Superhuman).
 */
function ResizableHandle({
  withHandle: _,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex items-center justify-center bg-transparent cursor-col-resize",
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        // Thin centered line via pseudo-element
        "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2",
        "before:bg-border before:transition-colors",
        "hover:before:bg-primary/40 active:before:bg-primary/60",
        // Horizontal orientation (between vertical panels)
        "[&[aria-orientation=horizontal]]:cursor-row-resize",
        className
      )}
      style={{ flexBasis: "8px" }}
      {...props}
    />
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
