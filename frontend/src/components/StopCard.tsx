import clsx from 'clsx'
import { Maximize2, PencilLine, X } from 'lucide-react'
import { lotsLabel, parkingSource, rainFor } from '../lib/conditions'
import { explainStop } from '../lib/explain'
import type { Camera } from '../lib/live'
import { duration, hm } from '../lib/time'
import type { OptimiseResult, RainCell, Stop } from '../lib/types'
import type { CameraView } from './CameraViewer'
import { distanceLabel } from './ConditionsPanel'
import { Button, CargoTag } from './ui'

interface Props {
  stop: Stop
  result: OptimiseResult
  names: Record<string, string>
  departure: number
  /** rain cells the plan was built with */
  rain: RainCell[]
  depotName: string
  /** nearest live LTA camera, in Live mode */
  camera?: { camera: Camera; km: number }
  /** show the camera image large, in the console */
  onViewCamera?: (v: CameraView) => void
  onClose: () => void
  /** Back to the draft with this stop open for editing. */
  onEdit?: () => void
  /** Render in flow (phone bottom sheet) instead of floating over the map. */
  inline?: boolean
}

export function StopCard({ stop, result, names, departure, rain, depotName, camera, onViewCamera, onClose, onEdit, inline }: Props) {
  const rec = result.recommended.byId[stop.id]
  const base = result.baseline.byId[stop.id]
  if (!rec || !base) return null
  const isRisk = result.highestRiskId === stop.id
  const cell = rainFor(stop, rain)
  const prevId = result.recommended.order[rec.seq - 2]
  const from = prevId ? (names[prevId] ?? prevId) : depotName
  const park = stop.parking
  // the plan used LTA road speeds (live, or typical for that time); otherwise
  // drive times are OSRM's free-flow estimate
  const live = result.trafficAt !== null

  const factors = [
    {
      key: 'W' as const,
      label: 'Weather',
      source: 'NEA 2-h',
      now: rec.inRain && cell ? `${cell.label} at ${hm(rec.start)}` : cell ? `Dry at ${hm(rec.start)}` : stop.forecast,
      was: base.inRain && cell ? `${cell.label} at ${hm(base.start)}` : cell ? `Dry at ${hm(base.start)}` : stop.forecast,
    },
    {
      key: 'P' as const,
      label: 'Parking',
      source: parkingSource(park),
      now: `${distanceLabel(park.distanceKm)} walk · ${lotsLabel(park)}`,
      was: park.code ? `Carpark ${park.code}` : park.name,
    },
    {
      key: 'T' as const,
      label: 'Traffic',
      source: result.trafficKind === 'typical' ? 'LTA typical' : live ? 'LTA live' : 'Not measured',
      now: live ? `+${Math.round(rec.trafficMinutes)} min on approach` : `${Math.round(rec.legMinutes)} min approach`,
      was: live ? `+${Math.round(base.trafficMinutes)} min on approach` : `${Math.round(base.legMinutes)} min approach`,
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
    <div
      className={
        inline
          ? 'w-full bg-panel'
          : 'animate-rise scroll-thin absolute top-16 right-4 z-20 max-h-[calc(100%-5rem)] w-[360px] overflow-y-auto rounded-panel bg-panel shadow-float'
      }
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="eyebrow">Stop {String(rec.seq).padStart(2, '0')}</span>
              {isRisk && (
                <span className="num rounded-full bg-bad-soft px-1.5 py-[1px] text-[9.5px] font-semibold tracking-[0.06em] text-bad">
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
          <Fact label="Cargo" value={<CargoTag cargo={stop.cargo} className="h-4" />} />
        </dl>
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="eyebrow">Why here</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{explainStop(stop, result, names, rain)}</p>
      </div>

      <div className="border-t border-line px-4 py-3">
        <dl className="space-y-2">
          <Detail label="Journey" source={live ? 'OSRM · LTA' : 'OSRM'}>
            <span className="num">
              {Math.round(rec.legMinutes)} min · {rec.legKm.toFixed(1)} km
            </span>
            <span className="text-fg-3"> from {from}</span>
            {live && rec.trafficMinutes >= 1 && (
              <span className="block text-fg-3">
                Includes <span className="num">{Math.round(rec.trafficMinutes)}</span> min of traffic (
                {result.trafficKind === 'typical' ? 'typical traffic at ' : 'LTA road speeds at '}
                <span className="num">{hm(result.trafficAt ?? 0)}</span>)
              </span>
            )}
          </Detail>
          <Detail label="Weather" source="NEA">
            {rec.inRain && cell ? (
              <span className="font-medium text-rain">
                {cell.label} <span className="num">{hm(cell.start)}–{hm(cell.end)}</span>
              </span>
            ) : (
              stop.forecast
            )}
            <span className="text-fg-3"> · {stop.area}</span>
          </Detail>
          <Detail label="Parking" source={parkingSource(park)}>
            <span className="block truncate" title={park.name}>
              {park.code && <span className="num mr-1 text-fg-3">{park.code}</span>}
              {park.name}
            </span>
            <span className="text-fg-3">
              {distanceLabel(park.distanceKm)} away ·{' '}
              {park.live ? <span className="num">{lotsLabel(park)}</span> : lotsLabel(park)}
            </span>
          </Detail>
          {camera && (
            <Detail label="Camera" source="LTA live">
              <button
                type="button"
                onClick={() => onViewCamera?.({ camera: camera.camera, stop: { name: stop.name, km: camera.km } })}
                title={`Enlarge camera ${camera.camera.id}${camera.camera.place ? ` · ${camera.camera.place}` : ''}`}
                className="group flex w-full items-center gap-2.5 rounded-[6px] text-left"
              >
                <span className="relative block h-[45px] w-[80px] shrink-0 overflow-hidden rounded-[6px] bg-subtle shadow-[inset_0_0_0_1px_var(--border-main)]">
                  <img src={camera.camera.image} alt={`LTA camera ${camera.camera.id}`} loading="lazy" className="size-full object-cover" />
                  <Maximize2
                    size={11}
                    className="absolute top-1 right-1 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100"
                  />
                </span>
                <span className="min-w-0 text-fg-3">
                  <span className="block truncate text-fg group-hover:underline">
                    {camera.camera.place ?? `Camera ${camera.camera.id}`}
                  </span>
                  <span className="num">
                    {distanceLabel(camera.km)} away · {hm(camera.camera.taken)}
                  </span>
                </span>
              </button>
            </Detail>
          )}
        </dl>
      </div>

      <div className="border-t border-line px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Risk factors</span>
          <span className="flex items-center gap-3 text-[10.5px] text-fg-3">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-3 rounded-full bg-brand" /> ColdRoute
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
                        className={clsx('block h-full rounded-full', a >= 0.66 ? 'bg-bad' : a >= 0.33 ? 'bg-warn' : 'bg-brand')}
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
        <Button size="sm" icon={<PencilLine size={12} strokeWidth={2} />} onClick={onEdit}>
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

/** One line of stop detail: what, from which source, and the value. */
function Detail({ label, source, children }: { label: string; source: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[78px_1fr] gap-3">
      <dt>
        <div className="text-[12px] font-medium">{label}</div>
        <div className="num text-[9.5px] tracking-[0.04em] text-fg-4 uppercase">{source}</div>
      </dt>
      <dd className="min-w-0 text-[12px] leading-[1.45] text-fg-2">{children}</dd>
    </div>
  )
}
