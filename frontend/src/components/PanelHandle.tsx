import clsx from 'clsx'
import { ChevronLeft, PanelLeftOpen } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export const PANEL = { min: 340, max: 600, default: 420 }
/** Dragging this far past the minimum width collapses the panel. */
const COLLAPSE_AT = PANEL.min - 90

const clamp = (w: number) => Math.min(PANEL.max, Math.max(PANEL.min, w))

interface HandleProps {
  width: number
  setWidth: (w: number) => void
  onCollapse: () => void
  onDragChange?: (dragging: boolean) => void
}

/**
 * Sits on the panel's right edge. Drag to resize, double-click to reset,
 * drag past the minimum or press the chevron to collapse. Keyboard: focus
 * it, then ←/→ to resize and Enter to collapse.
 */
export function PanelHandle({ width, setWidth, onCollapse, onDragChange }: HandleProps) {
  const [dragging, setDragging] = useState(false)
  const [willCollapse, setWillCollapse] = useState(false)
  const start = useRef({ x: 0, w: 0 })

  const setDrag = (d: boolean) => {
    setDragging(d)
    onDragChange?.(d)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, w: width }
    setDrag(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const raw = start.current.w + e.clientX - start.current.x
    setWillCollapse(raw < COLLAPSE_AT)
    setWidth(clamp(raw))
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const raw = start.current.w + e.clientX - start.current.x
    setDrag(false)
    setWillCollapse(false)
    if (raw < COLLAPSE_AT) {
      setWidth(clamp(start.current.w)) // reopen at the width it had before
      onCollapse()
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') setWidth(clamp(width - 16))
    else if (e.key === 'ArrowRight') setWidth(clamp(width + 16))
    else if (e.key === 'Enter') onCollapse()
    else return
    e.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={PANEL.min}
      aria-valuemax={PANEL.max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Drag to resize · double-click to reset · [ to hide"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setWidth(PANEL.default)}
      onKeyDown={onKeyDown}
      className="group absolute top-0 -right-[6px] bottom-0 z-30 w-3 cursor-col-resize touch-none outline-none"
    >
      <span
        className={clsx(
          'absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 transition-colors',
          willCollapse ? 'bg-fg-4' : dragging ? 'bg-brand' : 'bg-transparent group-hover:bg-brand/50 group-focus-visible:bg-brand',
        )}
      />
      <button
        type="button"
        aria-label="Hide panel"
        title="Hide panel  ["
        onClick={onCollapse}
        className={clsx(
          'absolute top-1/2 left-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-panel text-fg-3 shadow-[0_0_0_1px_var(--border-dark),0_1px_3px_rgba(28,25,23,0.12)] transition-[color,opacity] hover:text-fg',
          dragging && 'opacity-0',
        )}
      >
        <ChevronLeft size={14} strokeWidth={2} />
      </button>
    </div>
  )
}

/** Shown over the map while the panel is hidden. */
export function PanelExpand({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Show panel  ["
      className="animate-rise absolute top-4 left-4 z-20 flex h-8 items-center gap-1.5 rounded-full bg-panel pr-3 pl-2.5 text-[12px] font-medium text-fg shadow-float hover:bg-subtle"
    >
      <PanelLeftOpen size={14} strokeWidth={1.8} className="text-brand-fg" />
      {label}
    </button>
  )
}
