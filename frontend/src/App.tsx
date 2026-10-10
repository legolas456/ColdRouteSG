import clsx from 'clsx'
import { Check, Loader2, Send } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BottomSheet, type Snap } from './components/BottomSheet'
import { MapView, type Layers } from './components/MapView'
import { PANEL, PanelExpand, PanelHandle } from './components/PanelHandle'
import { ResultsPanel, type View } from './components/ResultsPanel'
import { TopBar } from './components/Shell'
import { StopCard } from './components/StopCard'
import { OPTIMISE_STEPS, StopsEditor } from './components/StopsEditor'
import { StyleMenu, type Layout } from './components/StyleMenu'
import { Timeline } from './components/Timeline'
import { Button, Segmented, StatusPill } from './components/ui'
import { DEPARTURE, DEPOT, PROFILES, SAMPLE_STOPS } from './data/sample'
import { optimise } from './lib/optimizer'
import { isTyping, PHONE_QUERY, useDebounced, useMediaQuery, usePersistentState } from './lib/hooks'
import { applyTheme, THEME_BY_ID, type ThemeId } from './lib/themes'
import type { OptimiseResult, ProfileId, Stop } from './lib/types'

type Phase = 'draft' | 'optimising' | 'optimised'

const params = new URLSearchParams(location.search)
const initialTheme = (): ThemeId => {
  const t = params.get('theme')
  // ?theme=night and ?style=dark come from earlier shared links
  return t === 'dark' || t === 'night' || params.get('style') === 'dark' ? 'dark' : 'light'
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

  // desktop: resizable, collapsible panel (remembered across reloads)
  const isPhone = useMediaQuery(PHONE_QUERY)
  const [panelW, setPanelW] = usePersistentState('coldroute.panel.width', PANEL.default)
  const [collapsed, setCollapsed] = usePersistentState('coldroute.panel.hidden', false)
  const [resizing, setResizing] = useState(false)
  // the map re-frames once the drag settles, not on every frame
  const insetW = useDebounced(collapsed ? 0 : panelW, 160)
  // phone: bottom sheet
  const [sheet, setSheet] = useState<Snap>('half')
  const [sheetH, setSheetH] = useState(0)
  const [sheetTab, setSheetTab] = useState<'plan' | 'timeline'>('plan')

  const theme = THEME_BY_ID[themeId]
  const floating = layout === 'float'
  const stopById = useMemo(() => Object.fromEntries(stops.map((s) => [s.id, s])), [stops])
  const names = useMemo(() => Object.fromEntries(stops.map((s) => [s.id, s.short])), [stops])

  // before paint, so there is no flash of the default theme
  useLayoutEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.delete('style')
    if (themeId === 'light') url.searchParams.delete('theme')
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
      if (e.key === '[' && !e.metaKey && !e.ctrlKey && !isTyping()) {
        e.preventDefault()
        setCollapsed((c) => !c)
      }
      if (e.key === '/' && phase === 'draft' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('input[placeholder^="Add a stop"]')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, runOptimise, setCollapsed])

  // phone: picking a stop on the map raises the sheet so its card is readable
  useEffect(() => {
    if (isPhone && selectedId) setSheet((s) => (s === 'peek' ? 'half' : s))
  }, [isPhone, selectedId])
  useEffect(() => {
    if (phase !== 'optimised') setSheetTab('plan')
  }, [phase])

  const share = () => {
    const done = () => setToast('Link copied · it opens this run in the same view')
    navigator.clipboard?.writeText(location.href).then(done, () => setToast(location.href))
  }

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
        Dispatch<span className="max-md:hidden"> to driver</span>
      </Button>
    ) : (
      <Button variant="primary" kbd="⌘↵" disabled={phase === 'optimising' || stops.length < 2} onClick={() => runOptimise()}>
        {phase === 'optimising' ? 'Optimising…' : <>Optimise<span className="max-md:hidden"> route</span></>}
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
      <StopCard
        stop={selectedStop}
        result={result}
        names={names}
        departure={departure}
        onClose={() => setSelectedId(null)}
        onEdit={() => setPhase('draft')}
        inline={isPhone}
      />
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
      cardOpen={!!card && !isPhone}
      compact={isPhone}
    >
      {!isPhone && card}
    </MapView>
  )

  const runLabel = `Morning run · ${stops.length} stops`
  const EXPAND_W = 168 // room for the "show panel" pill before the layer chips
  const topBar = (
    <TopBar
      status={status}
      primary={primary}
      updatedAt="09:05"
      onShare={share}
      extra={<StyleMenu themeId={themeId} setThemeId={setThemeId} layout={layout} setLayout={setLayout} phase={phase} jump={jump} />}
    />
  )
  const toastEl = toast && (
    <div className="animate-rise fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-medium text-on-ink shadow-float max-md:top-16 max-md:bottom-auto">
      <Check size={13} strokeWidth={2.5} className="shrink-0" /> <span className="truncate">{toast}</span>
    </div>
  )
  const handle = (
    <PanelHandle width={panelW} setWidth={setPanelW} onCollapse={() => setCollapsed(true)} onDragChange={setResizing} />
  )
  const expand = collapsed && <PanelExpand label={runLabel} onClick={() => setCollapsed(false)} />

  // Phone: full-bleed map with the panel in a bottom sheet
  if (isPhone) {
    const showTimeline = sheetTab === 'timeline' && !!timeline && !card
    return (
      <div className="flex h-full flex-col bg-canvas text-fg">
        {topBar}
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute inset-0">{map(0, sheetH)}</div>
          <BottomSheet
            snap={sheet}
            setSnap={setSheet}
            onHeight={setSheetH}
            scrollAll={!showTimeline}
            contentKey={card ? `stop-${selectedId}` : showTimeline ? 'timeline' : phase}
            header={
              timeline && !card ? (
                <div className="px-4 pb-2">
                  <Segmented
                    size="sm"
                    className="w-full"
                    value={sheetTab}
                    onChange={setSheetTab}
                    options={[
                      { value: 'plan', label: 'Plan' },
                      { value: 'timeline', label: 'Timeline' },
                    ]}
                  />
                </div>
              ) : null
            }
          >
            {card ?? (showTimeline ? timeline : left)}
          </BottomSheet>
        </main>
        {toastEl}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      {topBar}
      {floating ? (
        <main className="relative min-h-0 flex-1">
          <div className="absolute inset-0">{map(collapsed ? EXPAND_W : insetW + 16, timeline ? 248 : 0)}</div>
          <aside
            style={{ width: panelW }}
            className={clsx('absolute top-4 bottom-4 left-4 z-20 flex flex-col rounded-panel bg-panel shadow-float', collapsed && 'hidden')}
          >
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-panel">{left}</div>
            {!collapsed && handle}
          </aside>
          {expand}
          {timeline && (
            <div
              className="animate-rise absolute right-4 bottom-4 z-10 h-[232px] overflow-hidden rounded-panel bg-panel shadow-float"
              style={{ left: collapsed ? 16 : panelW + 32 }}
            >
              {timeline}
            </div>
          )}
        </main>
      ) : (
        <main className="flex min-h-0 flex-1">
          <aside
            inert={collapsed}
            style={{ width: collapsed ? 0 : panelW }}
            className={clsx(
              'relative flex shrink-0 flex-col bg-panel',
              collapsed ? 'overflow-hidden' : 'border-r border-line',
              !resizing && 'transition-[width] duration-200 ease-out',
            )}
          >
            {/* fixed inner width: the content slides out instead of re-wrapping */}
            <div className="flex h-full min-h-0 flex-col overflow-hidden" style={{ width: panelW }}>
              {left}
            </div>
            {!collapsed && handle}
          </aside>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
              {map(collapsed ? EXPAND_W : 0, 0)}
              {expand}
            </div>
            {timeline && <div className="h-[236px] shrink-0 border-t border-line bg-panel">{timeline}</div>}
          </section>
        </main>
      )}
      {toastEl}
    </div>
  )
}

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`
