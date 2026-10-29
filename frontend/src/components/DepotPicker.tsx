import { ChevronDown, Loader2, MapPin, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DEPOT } from '../data/sample'
import { depotFromPlace } from '../lib/depot'
import { useDebounced } from '../lib/hooks'
import { searchPlaces, type Place } from '../lib/places'
import type { Depot } from '../lib/types'

interface Props {
  depot: Depot
  onChange: (depot: Depot) => void
}

/** A depot uses the same OneMap search as stops, but keeps its own road-cache ID. */
export function DepotPicker({ depot, onChange }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const settled = useDebounced(query.trim(), 250)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  useEffect(() => {
    if (!open || settled.length < 2) {
      setHits([])
      setLoading(false)
      setError(false)
      return
    }
    const controller = new AbortController()
    setHits([])
    setLoading(true)
    setError(false)
    searchPlaces(settled, controller.signal)
      .then((places) => {
        setHits(places)
        setLoading(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setHits([])
          setLoading(false)
          setError(true)
        }
      })
    return () => controller.abort()
  }, [open, settled])

  const choose = (next: Depot) => {
    onChange(next)
    setQuery('')
    setHits([])
    setOpen(false)
  }

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-label={`From depot: ${depot.name}. Change depot`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="block w-full rounded-control px-2.5 py-1.5 text-left shadow-[inset_0_0_0_1px_var(--border-dark)] transition-shadow hover:bg-hover"
      >
        <span className="block text-[10.5px] text-fg-3">From depot</span>
        <span className="flex h-5 items-center justify-between gap-2 text-[13px] font-medium">
          <span className="truncate" title={depot.address}>{depot.name}</span>
          <ChevronDown size={14} className="shrink-0 text-fg-3" />
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[min(320px,calc(100vw-40px))] rounded-panel bg-panel p-2 shadow-float">
          <label className="flex items-center gap-2 rounded-control border border-line px-2.5 py-2">
            <Search size={14} className="shrink-0 text-fg-3" />
            <input
              autoFocus
              aria-label="Search depot address"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false)
                if (event.key === 'Enter' && query.trim() === settled && hits[0]) choose(depotFromPlace(hits[0]))
              }}
              placeholder="Search a depot address"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-4"
            />
            {loading && <Loader2 size={14} className="shrink-0 animate-spin text-fg-3" />}
          </label>
          <div className="mt-1 max-h-64 overflow-y-auto scroll-thin">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(DEPOT)}
              className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-[12px] hover:bg-hover"
            >
              <MapPin size={14} className="shrink-0 text-fg-3" />
              <span>Use sample depot · {DEPOT.name}</span>
            </button>
            {error && <p className="px-2.5 py-2 text-[12px] text-bad">OneMap did not respond. Try again.</p>}
            {!loading && !error && settled.length >= 2 && hits.length === 0 && (
              <p className="px-2.5 py-2 text-[12px] text-fg-3">No matches. Try a postal code.</p>
            )}
            {(query.trim() === settled ? hits : []).map((place) => (
              <button
                type="button"
                key={place.key}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(depotFromPlace(place))}
                className="flex w-full items-start gap-2 rounded-control px-2.5 py-2 text-left hover:bg-hover"
              >
                <MapPin size={14} className="mt-0.5 shrink-0 text-fg-3" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{place.name}</span>
                  <span className="block truncate text-[11.5px] text-fg-3">{place.address}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
