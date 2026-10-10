import clsx from 'clsx'
import { Check, Palette } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui'

export type Preset = 'paper' | 'editorial' | 'mapfirst' | 'dark'

export const PRESETS: Array<{ id: Preset; name: string; note: string; swatch: [string, string, string] }> = [
  { id: 'paper', name: 'Manus Paper', note: 'Warm off-white, soft cards, serif titles', swatch: ['#f8f8f7', '#ffffff', '#1a1a19'] },
  { id: 'editorial', name: 'Editorial', note: 'Pure white, hairlines, square corners', swatch: ['#ffffff', '#ffffff', '#000000'] },
  { id: 'mapfirst', name: 'Map-first', note: 'Full-bleed map, floating panels', swatch: ['#ededea', '#ffffff', '#1a1a19'] },
  { id: 'dark', name: 'Manus Dark', note: 'Night shift and control-room screens', swatch: ['#1a1a1a', '#212121', '#f2f2f2'] },
]

interface Props {
  preset: Preset
  setPreset: (p: Preset) => void
  signal: boolean
  setSignal: (b: boolean) => void
  phase: 'draft' | 'optimising' | 'optimised'
  jump: (to: 'draft' | 'optimised') => void
}

export function StyleMenu({ preset, setPreset, signal, setSignal, phase, jump }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" icon={<Palette size={14} strokeWidth={1.8} />} onClick={() => setOpen(!open)}>
        Style
      </Button>
      {open && (
        <div className="animate-rise absolute top-10 right-0 z-50 w-[300px] rounded-panel bg-panel p-1.5 shadow-float">
          <div className="eyebrow px-2.5 pt-2 pb-1.5">Design direction</div>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left transition-colors',
                preset === p.id ? 'bg-hover' : 'hover:bg-hover',
              )}
            >
              <span className="flex h-8 w-11 shrink-0 overflow-hidden rounded-[6px] shadow-[inset_0_0_0_1px_var(--border-dark)]">
                <span className="w-1/3" style={{ background: p.swatch[0] }} />
                <span className="flex w-2/3 flex-col justify-center gap-1 px-1" style={{ background: p.swatch[1] }}>
                  <span className="h-[3px] w-full rounded-full" style={{ background: p.swatch[2] }} />
                  <span className="h-[3px] w-2/3 rounded-full opacity-30" style={{ background: p.swatch[2] }} />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{p.name}</span>
                <span className="block truncate text-[11.5px] text-fg-3">{p.note}</span>
              </span>
              {preset === p.id && <Check size={14} className="text-fg" />}
            </button>
          ))}
          <div className="my-1.5 h-px bg-line" />
          <label className="flex cursor-pointer items-center gap-3 rounded-control px-2.5 py-2 hover:bg-hover">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">Signal colour</span>
              <span className="block text-[11.5px] text-fg-3">Red only for late and highest-risk</span>
            </span>
            <button
              role="switch"
              aria-checked={signal}
              onClick={() => setSignal(!signal)}
              className={clsx('relative h-5 w-9 rounded-full transition-colors', signal ? 'bg-ink' : 'bg-stronger')}
            >
              <span
                className={clsx(
                  'absolute top-0.5 size-4 rounded-full bg-panel shadow transition-transform',
                  signal ? 'translate-x-[18px]' : 'translate-x-0.5',
                )}
              />
            </button>
          </label>
          <div className="my-1.5 h-px bg-line" />
          <div className="eyebrow px-2.5 pt-1 pb-1.5">Jump to state</div>
          <div className="flex gap-1 px-1.5 pb-1.5">
            <Button size="sm" className="flex-1" variant={phase === 'draft' ? 'primary' : 'secondary'} onClick={() => jump('draft')}>
              Input
            </Button>
            <Button size="sm" className="flex-1" variant={phase === 'optimised' ? 'primary' : 'secondary'} onClick={() => jump('optimised')}>
              Results
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
