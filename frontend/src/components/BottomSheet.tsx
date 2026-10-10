import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

export type Snap = 'peek' | 'half' | 'full'
const ORDER: Snap[] = ['peek', 'half', 'full']
const PEEK = 196

interface Props {
  snap: Snap
  setSnap: (s: Snap) => void
  /** Reports the settled height, so the map can keep the route above the sheet. */
  onHeight?: (h: number) => void
  /** Rendered in the drag area under the grabber. */
  header?: ReactNode
  /**
   * true: the content scrolls as one page (panels whose own list would
   * otherwise scroll). false: the child fills the sheet (e.g. the timeline).
   */
  scrollAll?: boolean
  /** Changing it scrolls the content back to the top (e.g. list -> stop card). */
  contentKey?: string
  children: ReactNode
}

/**
 * Phone bottom sheet with three resting heights. Drag the grabber area
 * (flick or release near a height), or tap it to step up.
 */
export function BottomSheet({ snap, setSnap, onHeight, header, scrollAll = true, contentKey, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Chrome returns a Promise from scrollTo; never hand it back to React as a cleanup
    body.current?.scrollTo({ top: 0 })
  }, [contentKey])
  const [avail, setAvail] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const start = useRef({ y: 0, h: 0, t: 0 })

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const measure = () => setAvail(parent.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  const heights: Record<Snap, number> = {
    peek: Math.min(PEEK, avail),
    half: Math.round(avail * 0.52),
    full: Math.max(0, avail - 8),
  }
  const settled = heights[snap]

  useEffect(() => {
    if (avail) onHeight?.(settled)
  }, [settled, avail, onHeight])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, [role="tab"], input')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { y: e.clientY, h: settled, t: performance.now() }
    setDrag(settled)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return
    const h = start.current.h - (e.clientY - start.current.y)
    setDrag(Math.min(heights.full, Math.max(heights.peek - 48, h)))
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return
    const dy = e.clientY - start.current.y
    const v = dy / Math.max(1, performance.now() - start.current.t) // px per ms, + is down
    const i = ORDER.indexOf(snap)
    let next: Snap
    if (Math.abs(dy) < 6) next = ORDER[i === 2 ? 1 : i + 1] // tap: step up, from full go back to half
    else if (v < -0.45) next = ORDER[Math.min(2, i + 1)] // flick up
    else if (v > 0.45) next = ORDER[Math.max(0, i - 1)] // flick down
    else {
      const h = start.current.h - dy
      next = ORDER.reduce((a, b) => (Math.abs(heights[b] - h) < Math.abs(heights[a] - h) ? b : a))
    }
    setDrag(null)
    setSnap(next)
  }

  return (
    <div
      ref={ref}
      className={clsx(
        'absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-[20px] bg-panel shadow-[0_-10px_36px_rgba(28,25,23,0.16),0_0_0_1px_var(--border-main)]',
        drag === null && 'transition-[height] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
      )}
      style={{ height: drag ?? settled, paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex justify-center pt-2 pb-1.5">
          <span className="h-1 w-9 rounded-full bg-stronger" />
        </div>
        {header}
      </div>
      <div
        ref={body}
        className={clsx(
          'min-h-0 flex-1 overscroll-contain',
          scrollAll ? 'overflow-y-auto [&>*]:h-auto [&>*]:min-h-full' : 'flex flex-col overflow-hidden',
        )}
      >
        {children}
      </div>
    </div>
  )
}
