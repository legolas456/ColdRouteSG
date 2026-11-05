import clsx from 'clsx'
import {
  ArrowDown,
  ArrowUp,
  Car,
  Check,
  Clock,
  CloudRain,
  Download,
  Minus,
  PencilLine,
  RefreshCw,
  Sparkles,
  SquareParking,
  Thermometer,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { areaName, lotsLabel, parkingSource, rainFor, type Conditions } from '../lib/conditions'
import { summarise } from '../lib/explain'
import { travel } from '../lib/optimizer'
import { downloadCsv, routeCsv } from '../lib/route-export'
import { duration, hm, signed } from '../lib/time'
import type { Depot, OptimiseResult, Plan, RainCell, Stop, StopResult } from '../lib/types'
import { distanceLabel } from './ConditionsPanel'
import { Button, CargoTag, Segmented } from './ui'

export type View = 'coldroute' | 'baseline' | 'compare'

interface Props {
  depot: Depot
  result: OptimiseResult
  stops: Record<string, Stop>
  stopList: Stop[]
  view: View
  setView: (v: View) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Both are omitted in a shared, view-only run. */
  onEdit?: () => void
  onReoptimise?: () => void
  profileLabel: string
  departure: number
  /** the data the plan was built on */
  data: Pick<Conditions, 'source' | 'at' | 'rain'>
}

const SOURCE_LABEL: Record<Conditions['source'], string> = {
  live: 'Live data',
  mixed: 'Live and recorded data',
  recorded: 'Recorded data',
}

export function ResultsPanel(props: Props) {
  const { depot, result, stops, stopList, view, setView, selectedId, onSelect, onEdit, onReoptimise, profileLabel, departure, data } = props
  const { recommended: rec, baseline: base } = result
  const shown: Plan = view === 'baseline' ? base : rec
  const other: Plan = view === 'baseline' ? rec : base
  const otherName = view === 'baseline' ? 'ColdRoute' : 'Shortest'

  const exposureDelta = ((shown.exposure - other.exposure) / other.exposure) * 100
  const last = stops[shown.order[shown.order.length - 1]]
  const backAt = shown.end + (last ? travel(last, depot).minutes : 0)

  const exportRoute = () => downloadCsv(routeCsv(result, stops, view, profileLabel, departure, data), `coldroute-${view}-route.csv`)

  return (
    <div className="@container scroll-thin min-h-0 md:h-full md:overflow-y-auto">
      <div className="px-5 pt-5">
        <div className="eyebrow">Optimised · {profileLabel}</div>
        <h1 className="mt-1.5 font-serif text-[26px] leading-[1.15] tracking-[-0.02em]">Morning run</h1>
        <p className="mt-1 text-fg-3">
          {SOURCE_LABEL[data.source]} from <span className="num">{hm(data.at)}</span> · {result.evaluated.toLocaleString()} stop orders checked in{' '}
          <span className="whitespace-nowrap">{Math.max(1, Math.round(result.elapsedMs))} ms</span>
        </p>
        {(onEdit || onReoptimise) && (
          <div className="mt-3 flex gap-2">
            {onEdit && (
              <Button className="shrink-0" icon={<PencilLine size={14} strokeWidth={1.8} />} onClick={onEdit}>
                Edit stops
              </Button>
            )}
            {onReoptimise && (
              <Button
                variant="tonal"
                className="min-w-0 flex-1"
                title={data.source === 'recorded' ? 'Run again on the same data' : 'Run again with the latest live data'}
                icon={<RefreshCw size={14} strokeWidth={1.8} />}
                onClick={onReoptimise}
              >
                Re-optimise
              </Button>
            )}
          </div>
        )}
        <Button size="sm" className="mt-2" icon={<Download size={14} strokeWidth={1.8} />} onClick={exportRoute}>
          Export route CSV
        </Button>
      </div>
      {/* same switch as the draft profile picker; stays reachable while the panel scrolls */}
      <div className="sticky top-0 z-10 bg-panel px-5 pt-3 pb-2">
        <Segmented<View>
          label="Route view"
          className="w-full"
          value={view}
          onChange={setView}
          options={[
            { value: 'coldroute', label: 'ColdRoute', title: 'The recommended, risk-aware plan' },
            {
              value: 'baseline',
              // "Shortest" alone on a narrow panel, like the KPI captions
              label: (
                <>
                  Shortest<span className="@max-sm:hidden"> route</span>
                </>
              ),
              title: 'Shortest route: minimises driving only',
            },
            { value: 'compare', label: 'Compare', title: 'Both plans on one map' },
          ]}
        />
      </div>

      <div className="mx-5 mt-2 grid grid-cols-2 overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--border-main)]">
        <Kpi
          label="Late deliveries"
          value={String(shown.lateStops)}
          valueTone={shown.lateStops > 0 ? 'bad' : other.lateStops > 0 ? 'ok' : undefined}
          delta={delta(shown.lateStops - other.lateStops, signed(shown.lateStops - other.lateStops), 'outcome')}
          sub={`${otherName}: ${other.lateStops}${other.lateMinutes ? ` · ${Math.round(other.lateMinutes)} min late` : ''}`}
          className="border-r border-b border-line"
        />
        <Kpi
          label="Cold-chain exposure"
          value={`${Math.round(shown.exposure)}`}
          unit="min"
          delta={delta(exposureDelta, `${signed(exposureDelta)}%`, 'outcome')}
          sub={`${otherName}: ${Math.round(other.exposure)} min`}
          className="border-b border-line"
        />
        <Kpi
          label="Drive time"
          value={`${Math.round(shown.drive)}`}
          unit="min"
          delta={delta(shown.drive - other.drive, signed(shown.drive - other.drive), 'cost')}
          sub={`${otherName}: ${Math.round(other.drive)} min`}
          className="border-r border-line"
        />
        <Kpi
          label="Distance"
          value={shown.km.toFixed(1)}
          unit="km"
          delta={delta(shown.km - other.km, signed(shown.km - other.km, 1), 'cost')}
          sub={`${otherName}: ${other.km.toFixed(1)} km`}
        />
      </div>

      {shown.lateStops > 0 && (
        <div role="alert" className="mx-5 mt-3 flex items-start gap-2 rounded-[10px] bg-bad-soft px-3.5 py-2.5">
          <TriangleAlert size={14} strokeWidth={2} className="mt-[2px] shrink-0 text-bad" />
          <p className="text-[12.5px] leading-relaxed text-fg">
            <span className="font-medium">
              {shown.lateStops} {shown.lateStops === 1 ? 'delivery' : 'deliveries'} late:
            </span>{' '}
            {shown.rows
              .filter((r) => r.late > 0)
              .map((r) => `${stops[r.id]?.short ?? r.id} +${Math.round(r.late)} min`)
              .join(' · ')}
          </p>
        </div>
      )}

      {view !== 'baseline' ? (
        <div className="mx-5 mt-4 rounded-[10px] bg-brand-soft px-3.5 py-3">
          <div className="eyebrow flex items-center gap-1.5 !text-brand-fg">
            <Sparkles size={12} strokeWidth={2} /> Why this route
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-fg">{summarise(result, stopList)}</p>
        </div>
      ) : (
        <div className="mx-5 mt-4 rounded-[10px] bg-subtle px-3.5 py-3">
          <div className="eyebrow">Shortest route</div>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-2">
            Minimises driving only. It ignores time windows, rain and parking, which is what most dispatch tools do today.
          </p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 px-5 pb-1.5">
        <h2 className="shrink-0 text-[13px] font-semibold">Stop order</h2>
        <span className="num min-w-0 truncate text-[11px] text-fg-3">
          Back at depot {hm(backAt)} · {duration(backAt - departure)}
        </span>
      </div>

      <ol className="relative pb-3">
        {shown.rows.map((row, i) => {
          const s = stops[row.id]
          const ref = other.byId[row.id]
          const move = ref ? ref.seq - row.seq : 0
          const isRisk = view !== 'baseline' && row.id === result.highestRiskId
          const selected = selectedId === row.id
          return (
            <li key={row.id} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
              <button
                onClick={() => onSelect(selected ? null : row.id)}
                className={clsx(
                  'group relative grid w-full grid-cols-[24px_1fr_auto] gap-3 px-5 py-2.5 text-left transition-colors',
                  selected ? 'bg-brand-soft/60' : 'hover:bg-hover',
                )}
              >
                {selected && <span className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-brand" />}
                {i < shown.rows.length - 1 && (
                  <span className="absolute top-[36px] bottom-[-10px] left-[31.5px] w-px bg-line-strong" />
                )}
                <span
                  className={clsx(
                    'num relative z-[1] mt-[1px] flex size-6 items-center justify-center rounded-full text-[11px] font-semibold',
                    view === 'baseline' ? 'bg-panel text-fg-2 shadow-[inset_0_0_0_1.5px_var(--text-4)]' : 'bg-brand text-on-brand',
                  )}
                >
                  {row.seq}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium">{s.name}</span>
                    {isRisk && (
                      <span className="num shrink-0 rounded-full bg-bad-soft px-1.5 py-[1px] text-[9.5px] font-semibold tracking-[0.06em] text-bad">
                        HIGHEST RISK
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-fg-3">
                    <span className="num shrink-0">
                      {hm(s.windowStart)}–{hm(s.windowEnd)}
                    </span>
                    <span className="text-fg-4">·</span>
                    <CargoTag cargo={s.cargo} className="h-4" />
                    {row.wait > 1 && (
                      // the timeline and stop card show the wait too; drop it when the panel is narrow
                      <span className="flex items-center gap-1.5 @max-sm:hidden">
                        <span className="text-fg-4">·</span>
                        <span>waits {Math.round(row.wait)} min</span>
                      </span>
                    )}
                  </span>
                  <Watchouts row={row} stop={s} departure={departure} rain={data.rain} />
                </span>
                <span className="flex flex-col items-end">
                  <span className="num text-[14px] font-medium">{hm(row.arrival)}</span>
                  {row.late > 0 ? (
                    <span className="num mt-0.5 text-[11px] font-medium text-bad">+{Math.round(row.late)} min late</span>
                  ) : (
                    <span
                      className={clsx(
                        'num mt-0.5 flex items-center gap-0.5 text-[11px]',
                        move !== 0 && view !== 'baseline' ? 'text-brand-fg' : 'text-fg-3',
                      )}
                    >
                      {move > 0 ? <ArrowUp size={11} /> : move < 0 ? <ArrowDown size={11} /> : <Minus size={11} />}
                      {move !== 0 ? Math.abs(move) : ''}
                      {view === 'compare' && ref && <span className="ml-1 text-fg-4">was #{ref.seq}</span>}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>

    </div>
  )
}

type Tone = 'good' | 'bad' | 'neutral'

/**
 * Lower is better for every KPI. Outcomes (lateness, exposure) turn red when
 * worse; costs (drive, distance) stay neutral because they are the trade-off.
 */
function delta(diff: number, text: string, kind: 'outcome' | 'cost'): { text: string; tone: Tone } {
  if (Math.abs(diff) < 0.05) return { text: 'same', tone: 'neutral' }
  return { text, tone: diff < 0 ? 'good' : kind === 'outcome' ? 'bad' : 'neutral' }
}

function Kpi({
  label,
  value,
  unit,
  sub,
  delta,
  valueTone,
  className,
}: {
  label: string
  value: string
  unit?: string
  sub: string
  delta?: { text: string; tone: Tone }
  valueTone?: 'ok' | 'bad'
  className?: string
}) {
  return (
    <div className={clsx('min-w-0 px-3.5 pt-3 pb-3', className)}>
      <div className="truncate text-[11.5px] text-fg-3" title={label}>
        {label}
      </div>
      <div className="mt-1 flex min-w-0 items-baseline gap-1">
        <span
          className={clsx(
            'font-serif text-[30px] leading-none tracking-[-0.03em]',
            valueTone === 'ok' && 'text-ok',
            valueTone === 'bad' && 'text-bad',
          )}
        >
          {value}
        </span>
        {unit && <span className="text-[12px] text-fg-3">{unit}</span>}
        {delta && (
          <span
            title={`${delta.text} vs the other plan`}
            className={clsx(
              'num ml-auto inline-flex h-[18px] shrink-0 items-center self-center rounded-full px-1.5 text-[10.5px] font-medium',
              delta.tone === 'good' && 'bg-ok-soft text-ok',
              delta.tone === 'bad' && 'bg-bad-soft text-bad',
              delta.tone === 'neutral' && 'bg-subtle text-fg-3',
            )}
          >
            {delta.text}
          </span>
        )}
      </div>
      <div className="mt-1.5 line-clamp-2 text-[11.5px] text-fg-3" title={sub}>
        {sub}
      </div>
    </div>
  )
}

interface Watchout {
  key: string
  Icon: LucideIcon
  text: string
  title: string
  value: number
}

/** A traffic delay shorter than this is within the noise of OSRM's estimate. */
const SLOW_APPROACH_MIN = 3

/**
 * What a dispatcher should know about a stop, in words. Only the factors that
 * actually need attention show up, worst first; the full five-factor breakdown
 * lives in the stop card.
 */
function watchouts(row: StopResult, s: Stop, departure: number, rain: RainCell[]): Watchout[] {
  const out: Watchout[] = []
  const { W, P, T, C, L } = row.risk
  const cell = rainFor(s, rain)
  if (W >= 0.66)
    out.push({
      key: 'W',
      Icon: CloudRain,
      value: W,
      text: 'Unloads in rain',
      title: cell
        ? `Unloading starts ${hm(row.start)}, inside the ${cell.label.toLowerCase()} over ${areaName(cell.area)} (${hm(cell.start)}–${hm(cell.end)})`
        : `Unloading starts ${hm(row.start)}, in rain`,
    })
  if (P >= 0.4)
    out.push({
      key: 'P',
      Icon: SquareParking,
      value: P,
      text: `${distanceLabel(s.parking.distanceKm)} walk`,
      title: `Nearest carpark: ${s.parking.name}, ${distanceLabel(s.parking.distanceKm)} away, ${lotsLabel(s.parking)} (${parkingSource(s.parking)})`,
    })
  // Only measured delays (without live road speeds trafficMinutes is 0) of a few
  // minutes or more. No ratio: at a weekday peak a leg takes only 1.1 to 1.3
  // times its free-flow time, so a ratio would hide minutes worth knowing.
  if (row.trafficMinutes >= SLOW_APPROACH_MIN)
    out.push({
      key: 'T',
      Icon: Car,
      value: T,
      text: `+${Math.round(row.trafficMinutes)} min traffic`,
      title: `LTA road speeds: the approach takes about ${Math.round(row.legMinutes)} min, ${Math.round(row.trafficMinutes)} more than in free-flowing traffic`,
    })
  if (C >= 0.4)
    out.push({
      key: 'C',
      Icon: Thermometer,
      value: C,
      text: `${duration(row.start - departure)} on board`,
      title: `${s.cargo} cargo has been in the van ${duration(row.start - departure)} when unloading starts`,
    })
  if (row.late <= 0 && L >= 0.6)
    out.push({ key: 'L', Icon: Clock, value: L, text: `${Math.round(row.slack)} min spare`, title: `Arrives ${Math.round(row.slack)} min before the window closes` })
  return out.sort((a, b) => b.value - a.value)
}

function Watchouts({ row, stop, departure, rain }: { row: StopResult; stop: Stop; departure: number; rain: RainCell[] }) {
  const items = watchouts(row, stop, departure, rain)
  if (!items.length)
    return (
      <span className="mt-1.5 flex items-center gap-1 text-[11.5px] text-fg-4">
        <Check size={12} strokeWidth={2.2} /> No issues
      </span>
    )
  const shown = items.slice(0, 2)
  const rest = items.slice(2)
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1">
      {shown.map(({ key, Icon, text, title, value }) => (
        <span
          key={key}
          title={title}
          className={clsx(
            'inline-flex h-5 items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium whitespace-nowrap',
            value >= 0.66 ? 'bg-bad-soft text-bad' : 'bg-subtle text-fg-2',
          )}
        >
          <Icon size={12} strokeWidth={2} className={value >= 0.66 ? '' : 'text-warn'} />
          {text}
        </span>
      ))}
      {rest.length > 0 && (
        <span title={rest.map((r) => r.text).join(' · ')} className="num px-0.5 text-[11px] text-fg-3">
          +{rest.length}
        </span>
      )}
    </span>
  )
}
