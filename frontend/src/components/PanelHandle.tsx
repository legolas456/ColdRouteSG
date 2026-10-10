import clsx from 'clsx'
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
 * drag past the minimum to hide. Showing/hiding by click lives in the top
 * bar (PanelToggle), so it never moves. Keyboard: focus it, then ←/→ to
 * resize and Enter to hide.
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
      title="Drag to resize · double-click to reset"
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
    </div>
  )
}
