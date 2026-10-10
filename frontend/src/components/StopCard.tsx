import clsx from 'clsx'
import { Lock, PencilLine, X } from 'lucide-react'
import { RAIN } from '../data/sample'
import { explainStop } from '../lib/explain'
import { duration, hm } from '../lib/time'
import type { OptimiseResult, Stop } from '../lib/types'
import { Button, Tag } from './ui'

interface Props {
  stop: Stop
  result: OptimiseResult
  names: Record<string, string>
  departure: number
  onClose: () => void
}

export function StopCard({ stop, result, names, departure, onClose }: Props) {
  const rec = result.recommended.byId[stop.id]
  const base = result.baseline.byId[stop.id]
  if (!rec || !base) return null
  const isRisk = result.highestRiskId === stop.id

  const factors = [
    {
      key: 'W' as const,
      label: 'Weather',
      source: 'NEA 2-h',
      now: rec.inRain ? `${RAIN.label} at ${hm(rec.start)}` : stop.area === RAIN.area ? `Dry by ${hm(rec.start)}` : stop.forecast,
      was: base.inRain ? `${RAIN.label} at ${hm(base.start)}` : stop.forecast,
    },
    {
      key: 'P' as const,
      label: 'Parking',
      source: 'HDB · URA',
      now: `${stop.parking.distanceKm} km walk · ${stop.parking.freePct}% free`,
      was: stop.parking.name,
    },
    {
      key: 'T' as const,
      label: 'Traffic',
      source: 'LTA',
      now: `${Math.round(rec.legMinutes)} min approach`,
      was: `${Math.round(base.legMinutes)} min approach`,
    },
    {
      key: 'C' as const,
      label: 'Cold-chain',
      source: stop.cargo,
      now: `${duration(rec.start - departure)} on board`,
      was: `${duration(base.start - departure)} on board`,
    },
    {
      key: 'L' as const,
      label: 'Lateness',
      source: 'Window',
      now: rec.late > 0 ? `${Math.round(rec.late)} min late` : `${Math.round(rec.slack)} min slack`,
      was: base.late > 0 ? `${Math.round(base.late)} min late` : `${Math.round(base.slack)} min slack`,
    },
  ]

  return (
    <div className="animate-rise absolute top-16 right-4 z-20 w-[360px] overflow-hidden rounded-panel bg-panel shadow-float">
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="eyebrow">Stop {String(rec.seq).padStart(2, '0')}</span>
              {isRisk && (
                <span className="num rounded-[4px] bg-ink px-1.5 py-[1px] text-[9.5px] font-semibold tracking-[0.06em] text-on-ink">
                  HIGHEST RISK
                </span>
              )}
            </div>
            <h3 className="mt-1 font-serif text-[18px] leading-tight tracking-[-0.01em]">{stop.name}</h3>
            <p className="mt-0.5 truncate text-[12px] text-fg-3">{stop.address}</p>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="-mt-0.5 -mr-1.5 flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <dl className="mt-3 grid grid-cols-[0.9fr_1.5fr_0.9fr_1.1fr] gap-px overflow-hidden rounded-control bg-line">
          <Fact label="ETA" value={hm(rec.arrival)} />
          <Fact label="Window" value={`${hm(stop.windowStart)}–${hm(stop.windowEnd)}`} />
          <Fact label="Unload" value={`${stop.service}`} sub="min" />
          <Fact label="Cargo" value={<Tag className="h-4 text-[9px]">{stop.cargo}</Tag>} />
        </dl>
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="eyebrow">Why here</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{explainStop(stop, result, names)}</p>
      </div>

      <div className="border-t border-line px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Risk factors</span>
          <span className="flex items-center gap-3 text-[10.5px] text-fg-3">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-3 rounded-full bg-ink" /> ColdRoute
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-3 rounded-full bg-stronger" /> Shortest
            </span>
          </span>
        </div>
        <ul className="mt-2 space-y-2">
          {factors.map((f) => {
            const a = rec.risk[f.key]
            const b = base.risk[f.key]
            return (
              <li key={f.key} className="grid grid-cols-[78px_1fr] gap-3">
                <div>
                  <div className="text-[12px] font-medium">{f.label}</div>
                  <div className="num text-[9.5px] tracking-[0.04em] text-fg-4 uppercase">{f.source}</div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                      <span
                        className={clsx('block h-full rounded-full', a >= 0.66 ? 'bg-signal' : 'bg-ink')}
                        style={{ width: `${Math.max(4, a * 100)}%` }}
                      />
                    </span>
                    <span className="w-[118px] truncate text-right text-[11px] text-fg-2">{f.now}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                      <span className="block h-full rounded-full bg-stronger" style={{ width: `${Math.max(4, b * 100)}%` }} />
                    </span>
                    <span className="w-[118px] truncate text-right text-[11px] text-fg-4">{f.was}</span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
        <Button size="sm" icon={<Lock size={12} strokeWidth={2} />}>
          Lock position
        </Button>
        <Button size="sm" variant="ghost" icon={<PencilLine size={12} strokeWidth={2} />}>
          Edit stop
        </Button>
        <div className="flex-1" />
        <span className="num text-[10.5px] text-fg-4">was #{base.seq}</span>
      </div>
    </div>
  )
}

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-subtle px-2.5 py-1.5">
      <dt className="text-[10px] text-fg-3">{label}</dt>
      <dd className="mt-0.5 flex h-5 items-center">
        <span className="num text-[13px] font-medium">{value}</span>
        {sub && <span className="num ml-0.5 text-[10.5px] text-fg-3">{sub}</span>}
      </dd>
    </div>
  )
}
