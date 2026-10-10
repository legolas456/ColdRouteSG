import clsx from 'clsx'
import { ArrowDown, ArrowUp, CloudRain, Minus, PencilLine, RefreshCw, Sparkles } from 'lucide-react'
import { DEPOT } from '../data/sample'
import { summarise } from '../lib/explain'
import { travel } from '../lib/optimizer'
import { duration, hm, signed } from '../lib/time'
import type { OptimiseResult, Plan, Stop } from '../lib/types'
import { Button, CargoTag, DotMeter, Segmented } from './ui'

export type View = 'coldroute' | 'baseline' | 'compare'

interface Props {
  result: OptimiseResult
  stops: Record<string, Stop>
  stopList: Stop[]
  view: View
  setView: (v: View) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  onEdit: () => void
  onReoptimise: () => void
  profileLabel: string
  departure: number
}

export function ResultsPanel(props: Props) {
  const { result, stops, stopList, view, setView, selectedId, onSelect, onEdit, onReoptimise, profileLabel, departure } =
    props
  const { recommended: rec, baseline: base } = result
  const shown: Plan = view === 'baseline' ? base : rec
  const other: Plan = view === 'baseline' ? rec : base
  const otherName = view === 'baseline' ? 'ColdRoute' : 'Shortest'

  const exposureDelta = ((shown.exposure - other.exposure) / other.exposure) * 100
  const last = stops[shown.order[shown.order.length - 1]]
  const backAt = shown.end + (last ? travel(last, DEPOT).minutes : 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-5 pt-5">
        <div className="eyebrow">
          Optimised · {profileLabel} · {result.evaluated.toLocaleString()} orders in {Math.max(1, Math.round(result.elapsedMs))} ms
        </div>
        <h1 className="mt-1.5 font-serif text-[26px] leading-[1.15] tracking-[-0.02em]">Morning run</h1>
        <Segmented<View>
          className="mt-3.5 w-full"
          value={view}
          onChange={setView}
          options={[
            { value: 'coldroute', label: 'ColdRoute' },
            { value: 'baseline', label: 'Shortest route' },
            { value: 'compare', label: 'Compare' },
          ]}
        />
      </div>

      <div className="mx-5 mt-4 grid grid-cols-2 overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--border-main)]">
        <Kpi
          label="Late deliveries"
          value={String(shown.lateStops)}
          valueTone={shown.lateStops > 0 ? 'bad' : other.lateStops > 0 ? 'ok' : undefined}
          delta={delta(shown.lateStops - other.lateStops, String(shown.lateStops - other.lateStops), 'outcome')}
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
          delta={delta(shown.drive - other.drive, `${signed(shown.drive - other.drive)} min`, 'cost')}
          sub={`${otherName}: ${Math.round(other.drive)} min`}
          className="border-r border-line"
        />
        <Kpi
          label="Distance"
          value={shown.km.toFixed(1)}
          unit="km"
          delta={delta(shown.km - other.km, `${signed(shown.km - other.km, 1)} km`, 'cost')}
          sub={`${otherName}: ${other.km.toFixed(1)} km`}
        />
      </div>

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
            Minimises driving only. It ignores time windows, showers and parking, which is what most dispatch tools do today.
          </p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between px-5 pb-1.5">
        <h2 className="text-[13px] font-semibold">Stop order</h2>
        <span className="num text-[11px] text-fg-3">
          Back at depot {hm(backAt)} · {duration(backAt - departure)}
        </span>
      </div>

      <ol className="scroll-thin relative min-h-0 flex-1 overflow-y-auto pb-2">
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
                  <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-3">
                    <span className="num">
                      {hm(s.windowStart)}–{hm(s.windowEnd)}
                    </span>
                    <span className="text-fg-4">·</span>
                    <CargoTag cargo={s.cargo} className="h-4" />
                    {row.wait > 1 && (
                      <>
                        <span className="text-fg-4">·</span>
                        <span>waits {Math.round(row.wait)} min</span>
                      </>
                    )}
                  </span>
                  <span className="mt-1.5 flex items-center gap-3">
                    <DotMeter label="W" value={row.risk.W} />
                    <DotMeter label="P" value={row.risk.P} />
                    <DotMeter label="T" value={row.risk.T} />
                    <DotMeter label="C" value={row.risk.C} />
                    <DotMeter label="L" value={row.risk.L} />
                  </span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="num text-[14px] font-medium">{hm(row.arrival)}</span>
                  {row.late > 0 ? (
                    <span className="num mt-0.5 text-[11px] font-medium text-bad">+{Math.round(row.late)} min late</span>
                  ) : row.inRain ? (
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-rain">
                      <CloudRain size={11} strokeWidth={2} /> in showers
                    </span>
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

      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" size="sm" icon={<PencilLine size={13} strokeWidth={1.8} />} onClick={onEdit}>
          Edit stops
        </Button>
        <div className="flex-1" />
        <span className="text-[11.5px] text-fg-3">Data from 09:05</span>
        <Button size="sm" icon={<RefreshCw size={13} strokeWidth={1.8} />} onClick={onReoptimise}>
          Re-optimise
        </Button>
      </div>
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
    <div className={clsx('px-3.5 pt-3 pb-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-fg-3">{label}</span>
        {delta && (
          <span
            className={clsx(
              'num inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-medium',
              delta.tone === 'good' && 'bg-ok-soft text-ok',
              delta.tone === 'bad' && 'bg-bad-soft text-bad',
              delta.tone === 'neutral' && 'bg-subtle text-fg-3',
            )}
          >
            {delta.text}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
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
      </div>
      <div className="mt-1.5 truncate text-[11.5px] text-fg-3">{sub}</div>
    </div>
  )
}
