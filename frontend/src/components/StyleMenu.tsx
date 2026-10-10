import { Moon, Palette, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ThemeId } from '../lib/themes'
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
        View
      </Button>
      {open && (
        <div className="animate-rise absolute top-10 right-0 z-50 w-[280px] rounded-panel bg-panel p-1.5 shadow-float">
          <Row label="Appearance">
            <Segmented<ThemeId>
              size="sm"
              value={themeId}
              onChange={setThemeId}
              options={[
                { value: 'light', label: <span className="flex items-center gap-1"><Sun size={12} /> Light</span> },
                { value: 'dark', label: <span className="flex items-center gap-1"><Moon size={12} /> Dark</span> },
              ]}
            />
          </Row>
          <Row label="Layout">
            <Segmented<Layout>
              size="sm"
              value={layout}
              onChange={setLayout}
              options={[
                { value: 'split', label: 'Split' },
                { value: 'float', label: 'Map-first' },
              ]}
            />
          </Row>
          <div className="my-1.5 h-px bg-line" />
          <div className="eyebrow px-2.5 pt-1 pb-1.5">Demo · jump to state</div>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
    </div>
  )
}
