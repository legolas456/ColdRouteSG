import clsx from 'clsx'
import {
  AlertCircle,
  Check,
  Loader2,
  MapPin,
  Scale,
  Search,
  ShieldCheck,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ADDRESS_BOOK, PROFILES } from '../data/sample'
import { travel } from '../lib/optimizer'
import { MAX_STOPS, searchPlaces, stopFromPlace, type Place } from '../lib/places'
import { useRoadsVersion } from '../lib/hooks'
import { duration, hm } from '../lib/time'
import type { Cargo, Depot, ProfileId, Stop } from '../lib/types'
import { DepotPicker } from './DepotPicker'
import { LAST_SLOT, MinutesPicker, TimePicker } from './Pickers'
import { Button, Divider, Kbd, Segmented, CargoTag } from './ui'

interface Props {
  depot: Depot
  setDepot: (depot: Depot) => void
  stops: Stop[]
  setStops: (s: Stop[]) => void
  departure: number
  setDeparture: (m: number) => void
  profile: ProfileId
  setProfile: (p: ProfileId) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  busy: boolean
  step: number
  onOptimise: () => void
  /** "Friday, 10 October" for the recorded morning, today in Live mode */
  dateLabel: string
  /** set the departure to the current Singapore time */
  onDepartNow: () => void
  /** replace the run with the 7 sample stops on the recorded rainy morning */
  onLoadSample: () => void
  /** true while the stops are exactly the sample run */
  isSample: boolean
  /** the next plan will use live LTA road speeds */
  trafficLive: boolean
}

export const OPTIMISE_STEPS = [
  { label: 'Reading 2-hour forecast', source: 'NEA' },
  { label: 'Checking carpark availability', source: 'HDB' },
  { label: 'Applying live road speeds', source: 'LTA' },
  { label: 'Scoring every stop order', source: 'ColdRoute' },
  { label: 'Comparing with the shortest route', source: 'OSRM' },
]
const TRAFFIC_STEP = 2
/** The traffic step when the plan will not use live road speeds. */
const NO_TRAFFIC_STEP = { label: 'Drive times without live traffic', source: 'OSRM' }

export function StopsEditor(props: Props) {
  const { depot, setDepot, stops, setStops, departure, setDeparture, profile, setProfile, selectedId, onSelect, onOptimise, busy, step, dateLabel, onDepartNow, onLoadSample, isSample, trafficLive } =
    props
  const reviewCount = stops.filter((s) => s.review).length
  const roads = useRoadsVersion()

  const estimate = useMemo(() => {
    let prev: { id: string; lng: number; lat: number } = depot
    let minutes = 0
    for (const s of stops) {
      minutes += travel(prev, s).minutes + s.service
      prev = s
    }
    return minutes
    // roads: re-estimate once OSRM has real times for new stops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depot, stops, roads])

  const update = (id: string, patch: Partial<Stop>) => setStops(stops.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const remove = (id: string) => {
    setStops(stops.filter((s) => s.id !== id))
    if (selectedId === id) onSelect(null)
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="px-5 pt-5">
        <div className="eyebrow">Draft · not dispatched</div>
        <h1 className="mt-1.5 font-serif text-[26px] leading-[1.15] tracking-[-0.02em]">Morning run</h1>
        <p className="mt-1 text-fg-3">{dateLabel} · Van SGX 4821K · Ahmad R.</p>
        {busy ? (
          <div className="mt-3 rounded-[10px] bg-subtle px-3.5 py-3">
            <OptimisingSteps step={step} count={stops.length} trafficLive={trafficLive} />
          </div>
        ) : (
          <Button
            variant="primary"
            kbd="⌘↵"
            className="mt-3 w-full"
            onClick={onOptimise}
            disabled={stops.length < 2}
            title={stops.length < 2 ? 'Add at least two stops' : 'Find the best delivery order'}
          >
            Optimise route
          </Button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-[148px_1fr] gap-2 px-5">
        <TimePicker
          label="Depart"
          variant="field"
          value={departure}
          onChange={setDeparture}
          extra={
            <button
              type="button"
              title="Leave now (Singapore time)"
              onClick={(e) => {
                e.preventDefault()
                onDepartNow()
              }}
              className="shrink-0 rounded-[5px] px-1.5 text-[11px] font-medium text-brand-fg hover:bg-brand-soft"
            >
              Now
            </button>
          }
        />
        <DepotPicker depot={depot} onChange={setDepot} />
      </div>

      <div className="mt-3 px-5">
        <div className="mb-1.5 text-[11.5px] text-fg-3">Optimise for</div>
        <Segmented
          label="Optimise for"
          className="w-full"
          value={profile}
          onChange={setProfile}
          options={(Object.keys(PROFILES) as ProfileId[]).map((p) => ({ value: p, label: PROFILES[p].label, icon: PROFILE_ICONS[p], title: PROFILES[p].hint }))}
        />
        <p className="mt-1.5 text-[12px] text-fg-3">{PROFILES[profile].hint}</p>
      </div>

      <Divider className="mt-4" />

      <div className="px-5 pt-3.5 pb-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-[13px] font-semibold">Stops</h2>
            <span className="num truncate text-[12px] text-fg-3">
              {stops.length} · about {duration(estimate)}
            </span>
          </div>
          {reviewCount > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-fg-2">
              <AlertCircle size={12} className="text-warn" /> {reviewCount} to check
            </span>
          ) : stops.length > 0 ? (
            <span className="shrink-0 text-[11.5px] text-fg-3">{isSample ? 'Sample run' : 'Addresses from OneMap'}</span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-3">
          <p className="min-w-0 text-[11.5px] text-fg-3">Add them in any order. ColdRoute sets the delivery sequence.</p>
          <span className="flex shrink-0 items-center gap-0.5">
            {!isSample && stops.length > 0 && (
              <TextButton onClick={onLoadSample} title="Replace the stops with the 7-stop sample run on the recorded rainy morning">
                Load sample
              </TextButton>
            )}
            {stops.length > 0 && (
              <TextButton
                onClick={() => {
                  setStops([])
                  onSelect(null)
                }}
                title="Remove every stop"
              >
                Clear
              </TextButton>
            )}
          </span>
        </div>
      </div>

      <div className="px-5 pb-2">
        <AddressSearch
          onPick={(entry) => {
            setStops([...stops, entry])
            onSelect(entry.id)
          }}
          existing={stops}
          departure={departure}
          full={stops.length >= MAX_STOPS}
        />
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
        {stops.length === 0 && (
          <div className="mx-5 mt-2 rounded-panel border border-dashed border-line-strong px-5 py-8 text-center">
            <MapPin className="mx-auto text-fg-4" size={20} strokeWidth={1.5} />
            <p className="mt-2 font-medium">No stops yet</p>
            <p className="mt-1 text-[12px] text-fg-3">Search any Singapore address or postal code above. For a demo, load the sample run.</p>
            <Button className="mt-3" onClick={onLoadSample}>
              Load sample run
            </Button>
          </div>
        )}
        <ul>
          {stops.map((s, i) => (
            <StopRow
              key={s.id}
              index={i + 1}
              stop={s}
              open={selectedId === s.id}
              onToggle={() => onSelect(selectedId === s.id ? null : s.id)}
              onChange={(patch) => update(s.id, patch)}
              onRemove={() => remove(s.id)}
            />
          ))}
        </ul>
      </div>

    </div>
  )
}

/** Small inline action in the brand colour, for secondary list actions. */
function TextButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className="rounded-[5px] px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap text-brand-fg hover:bg-brand-soft">
      {children}
    </button>
  )
}

function StopRow({
  index,
  stop,
  open,
  onToggle,
  onChange,
  onRemove,
}: {
  index: number
  stop: Stop
  open: boolean
  onToggle: () => void
  onChange: (patch: Partial<Stop>) => void
  onRemove: () => void
}) {
  return (
    <li className={clsx('group relative transition-colors', open ? 'bg-hover' : 'hover:bg-hover')}>
      {open && <span className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-brand" />}
      <div className="flex cursor-pointer items-start gap-3 px-5 py-2.5" onClick={onToggle}>
        <span
          className={clsx(
            'num mt-[1px] flex size-[22px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold',
            open ? 'bg-brand text-on-brand' : 'bg-brand-soft text-brand-fg',
          )}
        >
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-[13.5px]">{stop.name}</span>
            {stop.review && <AlertCircle size={13} className="shrink-0 text-warn" />}
          </div>
          <div className="truncate text-[12px] text-fg-3">{stop.address}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1" title={`${stop.service} min to unload`}>
          <span className="num text-[12px] text-fg">
            {hm(stop.windowStart)}–{hm(stop.windowEnd)}
          </span>
          <CargoTag cargo={stop.cargo} />
        </div>
        <button
          aria-label="Remove stop"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="-mr-2 flex size-6 shrink-0 items-center justify-center rounded-md text-fg-4 opacity-0 transition hover:bg-strong hover:text-fg group-hover:opacity-100"
        >
          <X size={13} />
        </button>
      </div>

      {stop.review && (
        <div className="mx-5 mb-2.5 ml-[54px] rounded-control bg-panel p-2.5 shadow-[inset_0_0_0_1px_var(--border-dark)]">
          <div className="text-[12px] text-fg-2">
            {stop.review.candidates.length} matches for “{stop.review.query}”. Pick the right one:
          </div>
          <div className="mt-1.5 flex flex-col gap-1">
            {stop.review.candidates.map((c) => (
              <button
                key={c}
                onClick={() => onChange({ address: c, review: undefined })}
                className="flex items-center justify-between rounded-md px-2 py-1 text-left text-[12px] hover:bg-hover"
              >
                <span>{c}</span>
                {c === stop.address && <span className="text-[11px] text-fg-3">best match</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {open && (
        <div className="animate-rise grid grid-cols-3 gap-2 px-5 pb-3 pl-[54px]">
          <TimePicker
            label="Opens"
            value={stop.windowStart}
            onChange={(windowStart) =>
              // opening at or after the close keeps the window's length
              onChange(
                windowStart < stop.windowEnd
                  ? { windowStart }
                  : { windowStart, windowEnd: Math.min(LAST_SLOT, windowStart + Math.max(30, stop.windowEnd - stop.windowStart)) },
              )
            }
          />
          <TimePicker label="Closes" value={stop.windowEnd} after={stop.windowStart} onChange={(windowEnd) => onChange({ windowEnd })} />
          <MinutesPicker label="Unload" value={stop.service} onChange={(service) => onChange({ service })} />
          <div role="radiogroup" aria-label="Cargo" className="col-span-3 grid grid-cols-3 gap-1.5">
            {CARGO_CHOICES.map((c) => {
              const on = stop.cargo === c.value
              return (
                <button
                  key={c.value}
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange({ cargo: c.value })}
                  className={clsx(
                    'flex min-w-0 flex-col items-start rounded-control px-2 py-1.5 text-left transition-[background-color,box-shadow] focus-visible:outline-offset-[-1px]',
                    on
                      ? 'bg-brand-soft shadow-[inset_0_0_0_1.5px_var(--brand)]'
                      : 'bg-panel shadow-[inset_0_0_0_1px_var(--border-dark)] hover:shadow-[inset_0_0_0_1px_var(--text-4)] active:bg-hover',
                  )}
                >
                  <span className={clsx('flex max-w-full items-center gap-1.5 text-[12px] font-medium', on ? 'text-brand-fg' : 'text-fg')}>
                    <span className={clsx('size-[7px] shrink-0 rounded-full', c.dot)} />
                    <span className="truncate">{c.label}</span>
                  </span>
                  <span className="num max-w-full truncate text-[10.5px] text-fg-3">{c.temp}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </li>
  )
}

const PROFILE_ICONS: Record<ProfileId, LucideIcon> = { pharma: ShieldCheck, balanced: Scale, fastest: Zap }

const CARGO_CHOICES: Array<{ value: Cargo; label: string; temp: string; dot: string }> = [
  { value: 'PHARMA', label: 'Pharma', temp: '2 to 8 °C', dot: 'bg-pharma' },
  { value: 'FROZEN', label: 'Frozen', temp: '−18 °C', dot: 'bg-frozen' },
  { value: 'CHILLED', label: 'Chilled', temp: '0 to 4 °C', dot: 'bg-chilled' },
]

type Hit = { kind: 'sample'; stop: Stop } | { kind: 'place'; place: Place }

/**
 * Add a stop: OneMap results for what you type (debounced, real addresses),
 * or the sample customers when the box is empty.
 */
function AddressSearch({
  onPick,
  existing,
  departure,
  full,
}: {
  onPick: (s: Stop) => void
  existing: Stop[]
  departure: number
  /** the run is at MAX_STOPS */
  full: boolean
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [found, setFound] = useState<{ q: string; places: Place[] } | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [adding, setAdding] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const query = q.trim()

  // debounced OneMap search; a newer query cancels the previous request
  useEffect(() => {
    if (query.length < 2) {
      setState('idle')
      return
    }
    const ctrl = new AbortController()
    setState('loading')
    const t = window.setTimeout(() => {
      searchPlaces(query, ctrl.signal)
        .then((places) => {
          setFound({ q: query, places })
          setState('idle')
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) setState('error')
          if (!(e instanceof DOMException)) console.warn('OneMap search failed', e)
        })
    }, 250)
    return () => {
      ctrl.abort()
      window.clearTimeout(t)
    }
  }, [query])

  const taken = new Set(existing.map((s) => `${s.name}|${s.address}`))
  const hits: Hit[] = query
    ? (found?.q === query ? found.places : [])
        .filter((p) => !taken.has(`${p.name}|${p.address}`))
        .map((place) => ({ kind: 'place', place }))
    : ADDRESS_BOOK.filter((a) => !taken.has(`${a.name}|${a.address}`)).map((stop) => ({ kind: 'sample', stop }))

  const pick = async (hit: Hit) => {
    if (adding) return
    if (hit.kind === 'sample') onPick(hit.stop)
    else {
      setAdding(hit.place.key)
      try {
        onPick(await stopFromPlace(hit.place, departure, existing.map((s) => s.id)))
      } finally {
        setAdding(null)
      }
    }
    setQ('')
    setFound(null)
    setOpen(false)
    inputRef.current?.blur()
  }

  const settled = query.length >= 2 && state === 'idle' && found?.q === query

  return (
    <div className="relative">
      <div
        className={clsx(
          'flex h-9 items-center gap-2 rounded-control bg-subtle px-2.5 transition-shadow focus-within:bg-panel focus-within:shadow-[inset_0_0_0_1.5px_var(--brand)]',
          full && 'opacity-60',
        )}
      >
        {state === 'loading' || adding ? (
          <Loader2 size={14} className="animate-spin text-fg-3" />
        ) : (
          <Search size={14} className="text-fg-3" />
        )}
        <input
          ref={inputRef}
          value={q}
          disabled={full}
          aria-label="Add a stop"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, hits.length - 1))
            if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
            if (e.key === 'Enter' && hits[active]) pick(hits[active])
            if (e.key === 'Escape') inputRef.current?.blur()
          }}
          placeholder={full ? `${MAX_STOPS} stops is the most for one van` : 'Add a stop by address or postal code'}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-4"
        />
        <Kbd>/</Kbd>
      </div>
      {open && !full && (
        <div className="animate-rise absolute inset-x-0 top-10 z-30 overflow-hidden rounded-panel bg-panel p-1 shadow-float">
          <div className="flex items-baseline justify-between gap-2 px-2.5 pt-1.5 pb-1">
            <span className="eyebrow">{query ? 'OneMap results' : 'Sample customers'}</span>
            {query && <span className="text-[10.5px] text-fg-4">Singapore Land Authority</span>}
          </div>
          {query.length === 1 && <div className="px-2.5 py-2 text-[12px] text-fg-3">Keep typing: a building, street or postal code.</div>}
          {state === 'error' && <div className="px-2.5 py-2 text-[12px] text-bad">OneMap did not respond. Check the connection and try again.</div>}
          {state === 'loading' && !hits.length && <div className="px-2.5 py-2 text-[12px] text-fg-3">Searching OneMap…</div>}
          {settled && hits.length === 0 && <div className="px-2.5 py-2 text-[12px] text-fg-3">No matches. Try a postal code.</div>}
          {hits.map((h, i) => {
            const name = h.kind === 'sample' ? h.stop.name : h.place.name
            const address = h.kind === 'sample' ? h.stop.address : h.place.address
            const key = h.kind === 'sample' ? h.stop.id : h.place.key
            return (
              <button
                key={key}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
                onMouseEnter={() => setActive(i)}
                className={clsx('flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left', i === active && 'bg-hover')}
              >
                {adding === key ? (
                  <Loader2 size={14} className="shrink-0 animate-spin text-fg-3" />
                ) : (
                  <MapPin size={14} className="shrink-0 text-fg-3" strokeWidth={1.7} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{name}</span>
                  <span className="block truncate text-[12px] text-fg-3">{address}</span>
                </span>
                {h.kind === 'sample' && <CargoTag cargo={h.stop.cargo} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OptimisingSteps({ step, count, trafficLive }: { step: number; count: number; trafficLive: boolean }) {
  const steps = OPTIMISE_STEPS.map((s, i) => (i === TRAFFIC_STEP && !trafficLive ? NO_TRAFFIC_STEP : s))
  // every order is scored up to 8 stops; above that the optimiser improves a route by local search
  const orders = count <= 8 ? Array.from({ length: count }, (_, i) => i + 1).reduce((a, b) => a * b, 1) : 0
  return (
    <div className="animate-rise">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-medium">Optimising…</span>
        <span className="num text-[11px] text-fg-3">{orders ? `${orders.toLocaleString()} orders` : 'local search'}</span>
      </div>
      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li key={s.label} className={clsx('flex items-center gap-2 text-[12px]', i > step ? 'text-fg-4' : 'text-fg-2')}>
            <span className="flex size-4 items-center justify-center">
              {i < step ? (
                <Check size={13} strokeWidth={2.2} className="text-fg" />
              ) : i === step ? (
                <Loader2 size={13} className="animate-spin text-fg" />
              ) : (
                <span className="size-1 rounded-full bg-fg-4" />
              )}
            </span>
            <span className="flex-1">{s.label}</span>
            <span className="num text-[10.5px] text-fg-4">{s.source}</span>
          </li>
        ))}
      </ol>
      <div className="mt-2.5 h-[2px] overflow-hidden rounded-full bg-strong">
        <div
          className="h-full bg-brand transition-[width] duration-300 ease-out"
          style={{ width: `${Math.min(100, ((step + 1) / OPTIMISE_STEPS.length) * 100)}%` }}
        />
      </div>
    </div>
  )
}
