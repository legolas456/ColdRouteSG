import { Check, Loader2, Send } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MapView, type Layers } from './components/MapView'
import { ResultsPanel, type View } from './components/ResultsPanel'
import { NavRail, TopBar } from './components/Shell'
import { StopCard } from './components/StopCard'
import { OPTIMISE_STEPS, StopsEditor } from './components/StopsEditor'
import { StyleMenu, type Layout } from './components/StyleMenu'
import { Timeline } from './components/Timeline'
import { Button, StatusPill } from './components/ui'
import { DEPARTURE, DEPOT, PROFILES, SAMPLE_STOPS } from './data/sample'
import { optimise } from './lib/optimizer'
import { applyTheme, THEME_BY_ID, type ThemeId } from './lib/themes'
import type { OptimiseResult, ProfileId, Stop } from './lib/types'

type Phase = 'draft' | 'optimising' | 'optimised'

const params = new URLSearchParams(location.search)
const initialTheme = (): ThemeId => {
  const t = params.get('theme')
  if (t && t in THEME_BY_ID) return t as ThemeId
  // links from the first mock-up used ?style=
  const legacy = params.get('style')
  if (legacy === 'dark') return 'night'
  if (legacy === 'paper' || legacy === 'editorial') return 'mono'
  return 'teal'
}
const initialLayout = (): Layout => (params.get('layout') === 'float' || params.get('style') === 'mapfirst' ? 'float' : 'split')

export default function App() {
  const [themeId, setThemeId] = useState<ThemeId>(initialTheme)
  const [layout, setLayout] = useState<Layout>(initialLayout)
  const [phase, setPhase] = useState<Phase>('draft')
  const [stops, setStops] = useState<Stop[]>(SAMPLE_STOPS)
  const [departure, setDeparture] = useState(DEPARTURE)
  const [profile, setProfile] = useState<ProfileId>('pharma')
  const [result, setResult] = useState<OptimiseResult | null>(null)
  const [view, setView] = useState<View>('coldroute')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [layers, setLayers] = useState<Layers>({ rain: true, parking: false, traffic: false, baseline: false })
  const [step, setStep] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const timers = useRef<number[]>([])

  const theme = THEME_BY_ID[themeId]
  const floating = layout === 'float'
  const stopById = useMemo(() => Object.fromEntries(stops.map((s) => [s.id, s])), [stops])
  const names = useMemo(() => Object.fromEntries(stops.map((s) => [s.id, s.short])), [stops])

  // before paint, so there is no flash of the default theme
  useLayoutEffect(() => applyTheme(theme), [theme])

  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.delete('style')
    if (themeId === 'teal') url.searchParams.delete('theme')
    else url.searchParams.set('theme', themeId)
    if (layout === 'split') url.searchParams.delete('layout')
    else url.searchParams.set('layout', layout)
    history.replaceState(null, '', url)
  }, [themeId, layout])

  const runOptimise = useCallback(
    (instant = false) => {
      timers.current.forEach(clearTimeout)
      const r = optimise(DEPOT, stops, departure, PROFILES[profile].weights)
      if (instant) {
        setResult(r)
        setPhase('optimised')
        return
      }
      setSelectedId(null)
      setPhase('optimising')
      setStep(0)
      OPTIMISE_STEPS.forEach((_, i) => {
        timers.current.push(window.setTimeout(() => setStep(i + 1), 340 * (i + 1)))
      })
      timers.current.push(
        window.setTimeout(() => {
          setResult(r)
          setView('coldroute')
          setPhase('optimised')
        }, 340 * OPTIMISE_STEPS.length + 220),
      )
    },
    [stops, departure, profile],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && phase === 'draft') {
        e.preventDefault()
        runOptimise()
      }
      if (e.key === 'Escape') setSelectedId(null)
      if (e.key === '/' && phase === 'draft' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('input[placeholder^="Add a stop"]')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, runOptimise])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const jump = (to: 'draft' | 'optimised') => {
    timers.current.forEach(clearTimeout)
    setSelectedId(null)
    if (to === 'draft') setPhase('draft')
    else runOptimise(true)
  }

  const status =
    phase === 'draft' ? (
      <StatusPill>Draft</StatusPill>
    ) : phase === 'optimising' ? (
      <StatusPill>
        <Loader2 size={11} className="animate-spin" /> Optimising
      </StatusPill>
    ) : (
      <StatusPill tone="ok">
        <Check size={11} strokeWidth={2.5} /> Optimised
      </StatusPill>
    )

  const primary =
    phase === 'optimised' ? (
      <Button
        variant="primary"
        icon={<Send size={13} strokeWidth={2} />}
        onClick={() => setToast(`Sent to Ahmad R. · ${stops.length} stops · first ETA ${result ? fmt(result.recommended.rows[0].arrival) : ''}`)}
      >
        Dispatch to driver
      </Button>
    ) : (
      <Button variant="primary" kbd="⌘↵" disabled={phase === 'optimising' || stops.length < 2} onClick={() => runOptimise()}>
        {phase === 'optimising' ? 'Optimising…' : 'Optimise route'}
      </Button>
    )

  const left =
    phase === 'optimised' && result ? (
      <ResultsPanel
        result={result}
        stops={stopById}
        stopList={stops}
        view={view}
        setView={setView}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onEdit={() => {
          setSelectedId(null)
          setPhase('draft')
        }}
        onReoptimise={() => runOptimise()}
        profileLabel={PROFILES[profile].label}
        departure={departure}
      />
    ) : (
      <StopsEditor
        stops={stops}
        setStops={setStops}
        departure={departure}
        setDeparture={setDeparture}
        profile={profile}
        setProfile={setProfile}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onOptimise={() => runOptimise()}
        busy={phase === 'optimising'}
        step={step}
      />
    )

  const selectedStop = selectedId ? stopById[selectedId] : null
  const card =
    phase === 'optimised' && result && selectedStop ? (
      <StopCard stop={selectedStop} result={result} names={names} departure={departure} onClose={() => setSelectedId(null)} />
    ) : null

  const timeline =
    phase === 'optimised' && result ? (
      <Timeline result={result} stops={stopById} view={view} departure={departure} selectedId={selectedId} onSelect={setSelectedId} />
    ) : null

  const map = (insetLeft: number, insetBottom: number) => (
    <MapView
      palette={theme.map}
      depot={DEPOT}
      stops={stops}
      result={phase === 'optimised' ? result : null}
      view={view}
      phase={phase}
      selectedId={selectedId}
      onSelect={setSelectedId}
      layers={layers}
      setLayers={setLayers}
      insetLeft={insetLeft}
      insetBottom={insetBottom}
      cardOpen={!!card}
    >
      {card}
    </MapView>
  )

  return (
    <div className="flex h-full bg-canvas text-fg">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          status={status}
          primary={primary}
          updatedAt="09:05"
          extra={<StyleMenu themeId={themeId} setThemeId={setThemeId} layout={layout} setLayout={setLayout} phase={phase} jump={jump} />}
        />
        {floating ? (
          <main className="relative min-h-0 flex-1">
            <div className="absolute inset-0">{map(416, timeline ? 248 : 0)}</div>
            <aside className="absolute top-4 bottom-4 left-4 z-20 flex w-[400px] flex-col overflow-hidden rounded-panel bg-panel shadow-float">
              {left}
            </aside>
            {timeline && (
              <div className="animate-rise absolute right-4 bottom-4 left-[432px] z-10 h-[232px] overflow-hidden rounded-panel bg-panel shadow-float">
                {timeline}
              </div>
            )}
          </main>
        ) : (
          <main className="flex min-h-0 flex-1">
            <aside className="flex w-[420px] shrink-0 flex-col border-r border-line bg-panel">{left}</aside>
            <section className="flex min-w-0 flex-1 flex-col">
              <div className="relative min-h-0 flex-1">{map(0, 0)}</div>
              {timeline && <div className="h-[236px] shrink-0 border-t border-line bg-panel">{timeline}</div>}
            </section>
          </main>
        )}
      </div>

      {toast && (
        <div className="animate-rise fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-medium text-on-ink shadow-float">
          <Check size={13} strokeWidth={2.5} /> {toast}
        </div>
      )}
    </div>
  )
}

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`
