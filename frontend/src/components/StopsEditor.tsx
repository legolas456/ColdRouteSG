import clsx from 'clsx'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  MapPin,
  Search,
  X,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ADDRESS_BOOK, DEPOT, PROFILES } from '../data/sample'
import { travel } from '../lib/optimizer'
import { duration, hm, parseHm } from '../lib/time'
import type { Cargo, ProfileId, Stop } from '../lib/types'
import { Button, Divider, Kbd, Segmented, CargoTag } from './ui'

interface Props {
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
}

export const OPTIMISE_STEPS = [
  { label: 'Reading 2-hour forecast', source: 'NEA' },
  { label: 'Checking carpark availability', source: 'HDB' },
  { label: 'Estimating traffic on approaches', source: 'LTA' },
  { label: 'Scoring every stop order', source: 'ColdRoute' },
  { label: 'Comparing with the shortest route', source: 'OSRM' },
]

export function StopsEditor(props: Props) {
  const { stops, setStops, departure, setDeparture, profile, setProfile, selectedId, onSelect, onOptimise, busy, step, dateLabel, onDepartNow } = props
  const reviewCount = stops.filter((s) => s.review).length

  const estimate = useMemo(() => {
    let prev: { id: string; lng: number; lat: number } = DEPOT
    let minutes = 0
    for (const s of stops) {
      minutes += travel(prev, s).minutes + s.service
      prev = s
    }
    return minutes
  }, [stops])

  const update = (id: string, patch: Partial<Stop>) => setStops(stops.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const remove = (id: string) => {
    setStops(stops.filter((s) => s.id !== id))
    if (selectedId === id) onSelect(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-5 pt-5">
        <div className="eyebrow">Draft · not dispatched</div>
        <h1 className="mt-1.5 font-serif text-[26px] leading-[1.15] tracking-[-0.02em]">Morning run</h1>
        <p className="mt-1 text-fg-3">{dateLabel} · Van SGX 4821K · Ahmad R.</p>
        {busy ? (
          <div className="mt-3 rounded-[10px] bg-subtle px-3.5 py-3">
            <OptimisingSteps step={step} count={stops.length} />
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

      <div className="mt-4 grid grid-cols-[124px_1fr] gap-2 px-5">
        <Field label="Depart">
          <span className="flex items-center gap-1">
            <TimeInput value={departure} onChange={setDeparture} className="min-w-0 flex-1 text-[13px]" />
            <button
              type="button"
              title="Leave now (Singapore time)"
              onClick={(e) => {
                e.preventDefault()
                onDepartNow()
              }}
              className="-mr-1 shrink-0 rounded-[5px] px-1.5 text-[11px] font-medium text-brand-fg hover:bg-brand-soft"
            >
              Now
            </button>
          </span>
        </Field>
        <Field label="From depot">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">{DEPOT.name}</span>
            <ChevronDown size={14} className="shrink-0 text-fg-3" />
          </span>
        </Field>
      </div>

      <div className="mt-3 px-5">
        <Segmented
          label="Optimisation profile"
          className="w-full"
          value={profile}
          onChange={setProfile}
          options={(Object.keys(PROFILES) as ProfileId[]).map((p) => ({ value: p, label: PROFILES[p].label }))}
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
          ) : (
            <span className="shrink-0 text-[11.5px] text-fg-3">Verified with OneMap</span>
          )}
        </div>
        <p className="mt-0.5 text-[11.5px] text-fg-3">Add them in any order. ColdRoute sets the delivery sequence.</p>
      </div>

      <div className="px-5 pb-2">
        <AddressSearch
          onPick={(entry) => {
            setStops([...stops, entry])
            onSelect(entry.id)
          }}
          existing={stops.map((s) => s.address)}
        />
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
        {stops.length === 0 && (
          <div className="mx-5 mt-2 rounded-panel border border-dashed border-line-strong px-5 py-8 text-center">
            <MapPin className="mx-auto text-fg-4" size={20} strokeWidth={1.5} />
            <p className="mt-2 font-medium">No stops yet</p>
            <p className="mt-1 text-[12px] text-fg-3">Search an address above, paste rows from Excel, or import a CSV.</p>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block cursor-pointer rounded-control px-2.5 py-1.5 shadow-[inset_0_0_0_1px_var(--border-dark)] transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_var(--brand)] hover:bg-hover">
      <span className="block text-[10.5px] text-fg-3">{label}</span>
      <span className="block h-5 text-[13px] leading-5 font-medium">{children}</span>
    </label>
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
          <MiniField label="Opens">
            <TimeInput value={stop.windowStart} onChange={(windowStart) => onChange({ windowStart })} />
          </MiniField>
          <MiniField label="Closes">
            <TimeInput value={stop.windowEnd} onChange={(windowEnd) => onChange({ windowEnd })} />
          </MiniField>
          <MiniField label="Unload (min)">
            <input
              type="number"
              min={1}
              value={stop.service}
              onChange={(e) => onChange({ service: Math.max(1, Number(e.target.value)) })}
              className="num w-full bg-transparent outline-none"
            />
          </MiniField>
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
                    'flex min-w-0 flex-col items-start rounded-control bg-panel px-2 py-1.5 text-left transition-shadow focus-visible:outline-offset-[-1px]',
                    on
                      ? 'shadow-[inset_0_0_0_1.5px_var(--brand)]'
                      : 'shadow-[inset_0_0_0_1px_var(--border-dark)] hover:shadow-[inset_0_0_0_1px_var(--text-4)]',
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

const CARGO_CHOICES: Array<{ value: Cargo; label: string; temp: string; dot: string }> = [
  { value: 'PHARMA', label: 'Pharma', temp: '2 to 8 °C', dot: 'bg-pharma' },
  { value: 'FROZEN', label: 'Frozen', temp: '−18 °C', dot: 'bg-frozen' },
  { value: 'CHILLED', label: 'Chilled', temp: '0 to 4 °C', dot: 'bg-chilled' },
]

/** 24-hour HH:MM field; commits on blur or Enter, reverts on invalid input. */
function TimeInput({ value, onChange, className }: { value: number; onChange: (m: number) => void; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const ok = /^([01]?\d|2[0-3]):?([0-5]\d)$/.exec(draft.trim())
    if (ok) onChange(parseHm(`${ok[1]}:${ok[2]}`))
    setDraft(null)
  }
  return (
    <input
      inputMode="numeric"
      value={draft ?? hm(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      onClick={(e) => e.stopPropagation()}
      className={clsx('num w-full bg-transparent outline-none', className)}
    />
  )
}

function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block rounded-control bg-panel px-2 py-1 shadow-[inset_0_0_0_1px_var(--border-dark)] focus-within:shadow-[inset_0_0_0_1.5px_var(--brand)]">
      <span className="block text-[10px] text-fg-3">{label}</span>
      <span className="block text-[12.5px]">{children}</span>
    </label>
  )
}

function AddressSearch({ onPick, existing }: { onPick: (s: Stop) => void; existing: string[] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = ADDRESS_BOOK.filter(
    (a) =>
      !existing.includes(a.address) &&
      (!q || `${a.name} ${a.address}`.toLowerCase().includes(q.toLowerCase().trim())),
  )

  const pick = (entry: Stop) => {
    onPick(entry)
    setQ('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="relative">
      <div className="flex h-9 items-center gap-2 rounded-control bg-subtle px-2.5 transition-shadow focus-within:bg-panel focus-within:shadow-[inset_0_0_0_1.5px_var(--brand)]">
        <Search size={14} className="text-fg-3" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1))
            if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
            if (e.key === 'Enter' && results[active]) pick(results[active])
            if (e.key === 'Escape') inputRef.current?.blur()
          }}
          placeholder="Add a stop by address or postal code"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-4"
        />
        <Kbd>/</Kbd>
      </div>
      {open && (
        <div className="animate-rise absolute inset-x-0 top-10 z-30 overflow-hidden rounded-panel bg-panel p-1 shadow-float">
          <div className="eyebrow px-2.5 pt-1.5 pb-1">{q ? 'OneMap results' : 'Recent customers'}</div>
          {results.length === 0 && <div className="px-2.5 py-2 text-[12px] text-fg-3">No matches. Try a postal code.</div>}
          {results.map((r, i) => (
            <button
              key={r.address}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
              onMouseEnter={() => setActive(i)}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left',
                i === active && 'bg-hover',
              )}
            >
              <MapPin size={14} className="shrink-0 text-fg-3" strokeWidth={1.7} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block truncate text-[12px] text-fg-3">{r.address}</span>
              </span>
              <CargoTag cargo={r.cargo} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function OptimisingSteps({ step, count }: { step: number; count: number }) {
  const orders = Array.from({ length: count }, (_, i) => i + 1).reduce((a, b) => a * b, 1)
  return (
    <div className="animate-rise">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-medium">Optimising…</span>
        <span className="num text-[11px] text-fg-3">{orders.toLocaleString()} orders</span>
      </div>
      <ol className="space-y-1">
        {OPTIMISE_STEPS.map((s, i) => (
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
