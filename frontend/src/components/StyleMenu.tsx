import clsx from 'clsx'
import { Check, Palette } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { THEMES, type ThemeId } from '../lib/themes'
import { Button, Segmented } from './ui'

export type Layout = 'split' | 'float'

interface Props {
  themeId: ThemeId
  setThemeId: (t: ThemeId) => void
  layout: Layout
  setLayout: (l: Layout) => void
  phase: 'draft' | 'optimising' | 'optimised'
  jump: (to: 'draft' | 'optimised') => void
}

export function StyleMenu({ themeId, setThemeId, layout, setLayout, phase, jump }: Props) {
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
        <div className="animate-rise absolute top-10 right-0 z-50 w-[320px] rounded-panel bg-panel p-1.5 shadow-float">
          <div className="eyebrow px-2.5 pt-2 pb-1.5">Brand colour</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setThemeId(t.id)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left transition-colors',
                themeId === t.id ? 'bg-hover' : 'hover:bg-hover',
              )}
            >
              <span
                className="relative flex h-8 w-11 shrink-0 items-end gap-[3px] overflow-hidden rounded-[7px] p-[5px] shadow-[inset_0_0_0_1px_var(--border-dark)]"
                style={{ background: t.swatch[0] }}
              >
                <span className="h-full w-[9px] rounded-[3px]" style={{ background: t.swatch[1] }} />
                <span className="flex flex-1 flex-col justify-end gap-[3px]">
                  <span className="h-[3px] w-full rounded-full" style={{ background: t.swatch[1], opacity: 0.35 }} />
                  <span className="h-[3px] w-2/3 rounded-full" style={{ background: t.swatch[2] }} />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  {t.name}
                  <span className="text-[11.5px] font-normal text-fg-3">{t.zh}</span>
                  {t.id === 'teal' && (
                    <span className="rounded-full bg-brand-soft px-1.5 text-[10px] font-medium text-brand-fg">Recommended</span>
                  )}
                </span>
                <span className="block truncate text-[11.5px] text-fg-3">{t.note}</span>
              </span>
              {themeId === t.id && <Check size={14} className="text-brand-fg" />}
            </button>
          ))}
          <div className="my-1.5 h-px bg-line" />
          <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
            <span className="text-[13px] font-medium">Layout</span>
            <Segmented<Layout>
              size="sm"
              value={layout}
              onChange={setLayout}
              options={[
                { value: 'split', label: 'Split' },
                { value: 'float', label: 'Map-first' },
              ]}
            />
          </div>
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
