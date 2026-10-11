import clsx from 'clsx'
import { Clock, ImageOff, Loader2, MapPin, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import neaAreas from '../data/nea-areas.json'
import { nearest } from '../lib/geo'
import { sgMinutes, type Camera } from '../lib/live'
import { hm } from '../lib/time'
import type { Stop } from '../lib/types'
import { distanceLabel } from './ConditionsPanel'

/** A camera to show large, and the stop it was opened from, if any. */
export interface CameraView {
  camera: Camera
  /** the stop the dispatcher came from; without it the run's nearest stop is named */
  stop?: { name: string; km: number }
}

const AREAS = (neaAreas.areas as [string, number, number][]).map(([name, lng, lat]) => ({ name, lng, lat }))

/** "just now", "4 min ago"; older than an hour, the time alone says enough */
const ago = (taken: number) => {
  const m = (sgMinutes(Date.now()) - taken + 1440) % 1440
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : null
}

/**
 * One LTA camera image, large. data.gov.sg serves the images as
 * application/octet-stream, so a plain link downloads them instead of showing
 * them; this keeps the dispatcher in the console. Full screen on phones.
 */
export function CameraViewer({ view, stops, onClose }: { view: CameraView; stops: Stop[]; onClose: () => void }) {
  const { camera } = view
  const [img, setImg] = useState<'loading' | 'ok' | 'error'>('loading')
  const closeBtn = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // a click that starts inside the dialog and ends on the backdrop is not a close
  const downOnBackdrop = useRef(false)

  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeBtn.current?.focus()
    // capture phase and stopped here, so Esc closes only this and not the
    // Conditions panel or the stop card underneath
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab') {
        // the close button is the only control: keep focus in the dialog
        e.preventDefault()
        closeBtn.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (back?.isConnected) back.focus()
    }
  }, [])

  const area = nearest(AREAS, camera)?.item.name
  const near =
    view.stop ??
    ((n) => (n ? { name: n.item.name, km: n.km } : undefined))(nearest(stops, camera))
  const title = camera.place ?? `Camera ${camera.id}`
  const fresh = ago(camera.taken)

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(16,24,40,0.56)] p-6 max-md:p-0"
      // stop here so the Conditions panel does not read this as a click outside it
      onMouseDown={(e) => {
        e.stopPropagation()
        downOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-title"
        aria-describedby="camera-meta"
        className="animate-rise flex max-h-full w-[min(960px,calc((100dvh_-_200px)*16/9))] max-w-full flex-col overflow-hidden rounded-panel bg-panel shadow-float max-md:h-full max-md:w-full max-md:rounded-none"
      >
        <div className="flex shrink-0 items-start gap-3 px-4 pt-3.5 pb-3 max-md:pt-[max(14px,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <div className="eyebrow">LTA traffic camera · {camera.id}</div>
            <h2 id="camera-title" title={title} className="mt-1 line-clamp-2 font-serif text-[18px] leading-tight tracking-[-0.01em]">
              {title}
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-fg-3">
              {area && <>{area} · </>}
              <span className="num">
                {camera.lat.toFixed(4)}, {camera.lng.toFixed(4)}
              </span>
            </p>
          </div>
          <button
            ref={closeBtn}
            aria-label="Close"
            title="Close (Esc)"
            onClick={onClose}
            className="-mt-0.5 -mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative aspect-video w-full shrink bg-subtle max-md:aspect-auto max-md:min-h-0 max-md:flex-1">
          {img !== 'error' && (
            <img
              src={camera.image}
              alt={`View from LTA camera ${camera.id}${camera.place ? `, ${camera.place}` : ''}`}
              draggable={false}
              onLoad={() => setImg('ok')}
              onError={() => setImg('error')}
              className={clsx('absolute inset-0 size-full object-contain transition-opacity duration-200', img === 'ok' ? 'opacity-100' : 'opacity-0')}
            />
          )}
          {img === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-fg-3">
              <Loader2 size={14} className="animate-spin" /> Loading the image…
            </div>
          )}
          {img === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-fg-3">
              <ImageOff size={18} strokeWidth={1.8} />
              This image is no longer available. Refresh the feeds for a newer one.
            </div>
          )}
        </div>

        <div
          id="camera-meta"
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[12px] text-fg-2 max-md:pb-[max(10px,env(safe-area-inset-bottom))]"
        >
          <span className="flex items-center gap-1.5">
            <Clock size={12} strokeWidth={1.8} className="shrink-0 text-fg-3" />
            <span className="num">LTA · {hm(camera.taken)}</span>
            {fresh && <span className="text-fg-3">· {fresh}</span>}
          </span>
          {near ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin size={12} strokeWidth={1.8} className="shrink-0 text-fg-3" />
              <span className="truncate">
                <span className="num">{distanceLabel(near.km)}</span> from <span className="font-medium text-fg">{near.name}</span>
              </span>
            </span>
          ) : (
            <span className="text-fg-3">No stops in this run yet</span>
          )}
          <span className="ml-auto text-[11px] text-fg-4 max-md:hidden">Esc to close</span>
        </div>
      </div>
    </div>
  )
}
