import clsx from 'clsx'
import { RAIN } from '../data/sample'
import { hm } from '../lib/time'
import type { OptimiseResult, Stop } from '../lib/types'
import type { View } from './ResultsPanel'

interface Props {
  result: OptimiseResult
  stops: Record<string, Stop>
  view: View
  departure: number
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function Timeline({ result, stops, view, departure, selectedId, onSelect }: Props) {
  const plan = view === 'baseline' ? result.baseline : result.recommended
  const ghost = view === 'compare' ? result.baseline : null

  const latest = Math.max(
    ...result.baseline.rows.map((r) => r.finish),
    ...result.recommended.rows.map((r) => r.finish),
    ...plan.rows.map((r) => stops[r.id].windowEnd),
  )
  const t0 = Math.floor(departure / 60) * 60
  const t1 = Math.min(Math.ceil((latest + 10) / 60) * 60, t0 + 8 * 60)
  const x = (m: number) => `${((Math.min(Math.max(m, t0), t1) - t0) / (t1 - t0)) * 100}%`
  const w = (a: number, b: number) => `${((Math.min(b, t1) - Math.max(a, t0)) / (t1 - t0)) * 100}%`
  const hours = Array.from({ length: (t1 - t0) / 60 + 1 }, (_, i) => t0 + i * 60)

  return (
    <div className="flex h-full min-h-0 flex-col px-5 pt-3 pb-3">
      <div className="flex items-center gap-4">
        <h2 className="text-[13px] font-semibold">Timeline</h2>
        <div className="flex-1" />
        <Legend swatch={<span className="h-2 w-5 rounded-[2px] bg-brand-soft shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_25%,transparent)]" />} label="Delivery window" />
        <Legend swatch={<span className="h-2 w-3 rounded-[2px] bg-brand" />} label="Unloading" />
        <Legend swatch={<span className="hatch-signal h-2 w-4 rounded-[2px]" />} label="Late" />
        <Legend swatch={<span className="hatch-rain h-2 w-4 rounded-[2px]" />} label={`${RAIN.label} · ${RAIN.area}`} />
        {ghost && <Legend swatch={<span className="h-2 w-3 rounded-[2px] shadow-[inset_0_0_0_1.5px_var(--text-3)]" />} label="Shortest route" />}
      </div>

      <div className="relative mt-2 min-h-0 flex-1">
        <div className="absolute inset-0 grid grid-cols-[150px_1fr] pr-5">
          <div />
          <div className="relative">
            {hours.map((h) => (
              <div key={h} className="absolute inset-y-0" style={{ left: x(h) }}>
                <div className="absolute inset-y-[18px] w-px bg-line" />
                <span className="num absolute top-0 -translate-x-1/2 text-[10.5px] text-fg-3">{hm(h)}</span>
              </div>
            ))}
            <div
              className="hatch-rain absolute top-[18px] bottom-0 shadow-[inset_1px_0_0_color-mix(in_srgb,var(--rain)_35%,transparent),inset_-1px_0_0_color-mix(in_srgb,var(--rain)_35%,transparent)]"
              style={{ left: x(RAIN.start), width: w(RAIN.start, RAIN.end) }}
            />
          </div>
        </div>

        <div className="scroll-thin relative h-full overflow-y-auto pt-[22px] pr-5">
          {plan.rows.map((row) => {
            const s = stops[row.id]
            const g = ghost?.byId[row.id]
            const selected = selectedId === row.id
            return (
              <button
                key={row.id}
                onClick={() => onSelect(selected ? null : row.id)}
                className={clsx(
                  'group grid h-[22px] w-full grid-cols-[150px_1fr] items-center rounded-[6px] text-left',
                  selected ? 'bg-brand-soft/60' : 'hover:bg-hover',
                )}
              >
                <span className="flex min-w-0 items-center gap-2 pl-1">
                  <span className="num w-4 text-right text-[10.5px] text-fg-3">{row.seq}</span>
                  <span className={clsx('truncate text-[12px]', selected ? 'font-semibold' : 'text-fg-2')}>{s.short}</span>
                </span>
                <span className="relative h-full">
                  <span
                    className="absolute top-1/2 h-[9px] -translate-y-1/2 rounded-[3px] bg-brand-soft shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_25%,transparent)]"
                    style={{ left: x(s.windowStart), width: w(s.windowStart, s.windowEnd) }}
                  />
                  {row.wait > 1 && (
                    <span
                      className="absolute top-1/2 h-px -translate-y-1/2 border-t border-dashed border-fg-3"
                      style={{ left: x(row.arrival), width: w(row.arrival, row.start) }}
                    />
                  )}
                  {row.late > 0 && (
                    <span
                      className="hatch-signal absolute top-1/2 h-[9px] -translate-y-1/2 rounded-[2px]"
                      style={{ left: x(s.windowEnd), width: w(s.windowEnd, row.start) }}
                    />
                  )}
                  {g && (
                    <span
                      className="absolute top-1/2 h-[13px] -translate-y-1/2 rounded-[3px] shadow-[inset_0_0_0_1.5px_var(--text-3)]"
                      style={{ left: x(g.start), width: `max(4px, ${w(g.start, g.finish)})` }}
                    />
                  )}
                  <span
                    className={clsx(
                      'absolute top-1/2 h-[13px] -translate-y-1/2 rounded-[3px] transition-transform',
                      row.late > 0 ? 'bg-bad' : 'bg-brand',
                      selected && 'scale-y-125',
                    )}
                    style={{ left: x(row.start), width: `max(4px, ${w(row.start, row.finish)})` }}
                  />
                  <span
                    className="num pointer-events-none absolute top-1/2 ml-1.5 -translate-y-1/2 text-[10.5px] text-fg-2 opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ left: x(row.finish) }}
                  >
                    {hm(row.start)}–{hm(row.finish)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-fg-3">
      {swatch}
      {label}
    </span>
  )
}
