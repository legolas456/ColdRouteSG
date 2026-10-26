import clsx from 'clsx'
import { Check, Copy, Eye, Loader2, Send } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AccountBar, AccountButton, SignInDialog, type User } from './components/Account'
import { BottomSheet, type Snap } from './components/BottomSheet'
import { CameraViewer, type CameraView } from './components/CameraViewer'
import { ConditionsPanel } from './components/ConditionsPanel'
import { MapView, type Layers } from './components/MapView'
import { PANEL, PanelHandle } from './components/PanelHandle'
import { ResultsPanel, type View } from './components/ResultsPanel'
import { SharePopover } from './components/SharePopover'
import { DataPill, TopBar, type ThemeMode } from './components/Shell'
import { StopCard } from './components/StopCard'
import { OPTIMISE_STEPS, StopsEditor } from './components/StopsEditor'
import { Timeline } from './components/Timeline'
import { Button, Segmented, StatusPill } from './components/ui'
import { DEPARTURE, DEPOT, PROFILES, RECORDED_AT, SAMPLE_STOPS } from './data/sample'
import { camerasNear, liveConditions, recordedConditions, type Conditions, type DataMode } from './lib/conditions'
import { ensureLive, isLoading, refreshLive, sgMinutes, useLiveFeeds } from './lib/live'
import { validDepot } from './lib/depot'
import { optimise } from './lib/optimizer'
import { MAX_STOPS } from './lib/places'
import { allReal, ensureLegs, ensureMatrix } from './lib/roads'
import { isTyping, PHONE_QUERY, useMediaQuery, usePersistentState } from './lib/hooks'
import { hm } from './lib/time'
import { applyTheme, THEME_BY_ID, type ThemeId } from './lib/themes'
import type { Depot, OptimiseResult, ProfileId, Stop } from './lib/types'

type Phase = 'draft' | 'optimising' | 'optimised'

// ---- URL contract -------------------------------------------------------
// ?share=<token>[&view=compare][&stop=<id>]  a teammate's read-only link
// ?state=results                             open straight on the result (demos, screenshots)
// ?theme=light|dark                          force a theme for this visit only
// ?data=live|recorded                        force the data mode for this visit only
const SHARE_TOKEN = 'mr1010-7k2f'

const SAMPLE_JSON = JSON.stringify(SAMPLE_STOPS)
/** Saved stops from an older build may not match today's shape: then start from the sample. */
const validStops = (v: unknown): v is Stop[] =>
  Array.isArray(v) &&
  v.length <= MAX_STOPS &&
  v.every(
    (s) =>
      s &&
      typeof s.id === 'string' &&
      typeof s.name === 'string' &&
      typeof s.short === 'string' &&
      Number.isFinite(s.lng) &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.windowStart) &&
      Number.isFinite(s.windowEnd) &&
      s.parking &&
      Number.isFinite(s.parking.distanceKm),
  )
const params = new URLSearchParams(location.search)
const sharedOnLoad = params.has('share')
const VIEWS: View[] = ['coldroute', 'baseline', 'compare']
const VIEW_LABEL: Record<View, string> = { coldroute: 'ColdRoute', baseline: 'Shortest route', compare: 'Compare' }
const urlView = VIEWS.find((v) => v === params.get('view')) ?? 'coldroute'
const urlStop = SAMPLE_STOPS.some((s) => s.id === params.get('stop')) ? params.get('stop') : null
const urlTheme = ((t) => (t === 'dark' || t === 'night' ? 'dark' : t === 'light' ? 'light' : null))(params.get('theme')) as ThemeId | null
const urlData = ((d) => (d === 'live' || d === 'recorded' ? d : null))(params.get('data')) as DataMode | null
const openOnResult = sharedOnLoad || params.get('state') === 'results'

// keep the address bar clean: drop one-off and legacy params, keep a share link intact
{
  const url = new URL(location.href)
  for (const k of ['theme', 'style', 'layout', 'state', 'data']) url.searchParams.delete(k)
  if (!sharedOnLoad) for (const k of ['view', 'stop']) url.searchParams.delete(k)
  history.replaceState(null, '', url)
}

const RECORDED_DATE_LABEL = 'Friday, 10 October'
/** Today in Singapore: "Sunday, 11 October", or "Sun 11 Oct" when short */
const todayLabel = (short = false) => {
  const len = short ? 'short' : 'long'
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: len, day: 'numeric', month: len, timeZone: 'Asia/Singapore' }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return short ? `${get('weekday')} ${get('day')} ${get('month')}` : `${get('weekday')}, ${get('day')} ${get('month')}`
}

export default function App() {
  // appearance: follows the OS until the user picks Light or Dark
  const [themeMode, setThemeMode] = usePersistentState<ThemeMode>('coldroute.theme', 'system')
  const [forcedTheme, setForcedTheme] = useState<ThemeId | null>(urlTheme)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const themeId: ThemeId = forcedTheme ?? (themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode)
  const theme = THEME_BY_ID[themeId]
  const pickTheme = (m: ThemeMode) => {
    setForcedTheme(null)
    setThemeMode(m)
  }

  const [readOnly, setReadOnly] = useState(sharedOnLoad)
  // mock account: signed out on first visit, remembered after that
  const [user, setUser] = usePersistentState<User | null>('coldroute.user', null)
  const [signIn, setSignIn] = useState<{ reason?: string; then?: () => void } | null>(null)
  const [phase, setPhase] = useState<Phase>('draft')
  // the run's stops are kept across reloads; a shared link shows its own snapshot
  const [savedStops, setSavedStops] = usePersistentState<Stop[]>('coldroute.stops.v1', SAMPLE_STOPS)
  const [savedDepot, setSavedDepot] = usePersistentState<Depot>('coldroute.depot.v1', DEPOT)
  const [snapshotStops, setSnapshotStops] = useState<Stop[]>(SAMPLE_STOPS)
  const stops = readOnly ? snapshotStops : validStops(savedStops) ? savedStops : SAMPLE_STOPS
  const depot = readOnly ? DEPOT : validDepot(savedDepot, DEPOT) ? savedDepot : DEPOT
  const setStops = readOnly ? setSnapshotStops : setSavedStops
  const isSample = useMemo(() => depot.id === DEPOT.id && JSON.stringify(stops) === SAMPLE_JSON, [depot, stops])
  const [departure, setDeparture] = useState(DEPARTURE)
  const [profile, setProfile] = useState<ProfileId>('pharma')
  const [result, setResult] = useState<OptimiseResult | null>(null)
  const [view, setView] = useState<View>(urlView)
  const [selectedId, setSelectedId] = useState<string | null>(urlStop)
  const [layers, setLayers] = useState<Layers>({ rain: true, parking: false, traffic: true, baseline: false })
  const [step, setStep] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const timers = useRef<number[]>([])
  const runToken = useRef(0)

  // data: the recorded rainy morning (default, keeps the demo case fixed) or
  // live public feeds. A shared run is a snapshot, so it always replays.
  const [savedMode, setSavedMode] = usePersistentState<DataMode>('coldroute.data', 'recorded')
  const [forcedMode, setForcedMode] = useState<DataMode | null>(urlData)
  const dataMode: DataMode = readOnly ? 'recorded' : (forcedMode ?? savedMode)
  const setDataMode = (m: DataMode) => {
    setForcedMode(null)
    setSavedMode(m)
  }
  const [condOpen, setCondOpen] = useState(false)
  const feeds = useLiveFeeds(dataMode === 'live' || condOpen)
  // an LTA camera image shown large, from the Conditions panel or a stop card
  const [cameraView, setCameraView] = useState<CameraView | null>(null)
  // the data the plan was built on; the draft always shows the current read
  const [planCond, setPlanCond] = useState<Conditions | null>(null)

  // desktop: resizable, collapsible panel (remembered across reloads)
  const isPhone = useMediaQuery(PHONE_QUERY)
  const [panelW, setPanelW] = usePersistentState('coldroute.panel.width', PANEL.default)
  const [collapsed, setCollapsed] = usePersistentState('coldroute.panel.hidden', false)
  const [resizing, setResizing] = useState(false)
  // phone: bottom sheet
  const [sheet, setSheet] = useState<Snap>('half')
  const [sheetH, setSheetH] = useState(0)
  const [sheetTab, setSheetTab] = useState<'plan' | 'timeline'>('plan')

  const names = useMemo(() => Object.fromEntries(stops.map((s) => [s.id, s.short])), [stops])
  const nowCond = useMemo(
    () =>
      dataMode === 'live' ? liveConditions(stops, feeds, sgMinutes(feeds.fetchedAt ?? Date.now()), departure) : recordedConditions(stops),
    [dataMode, stops, feeds, departure],
  )
  const shownCond = phase === 'optimised' && planCond ? planCond : nowCond
  // stops as the plan sees them: live forecast area and nearest carpark applied
  const stopById = useMemo(() => Object.fromEntries(shownCond.stops.map((s) => [s.id, s])), [shownCond])

  // before paint, so there is no flash of the other theme
  useLayoutEffect(() => {
    applyTheme(theme)
  }, [theme])

  const runOptimise = useCallback(
    (instant = false) => {
      const token = ++runToken.current
      timers.current.forEach(clearTimeout)
      timers.current = []
      const conditions: Promise<Conditions> =
        dataMode === 'live'
          ? ensureLive().then((f) => liveConditions(stops, f, sgMinutes(f.fetchedAt ?? Date.now()), departure))
          : Promise.resolve(recordedConditions(stops))
      // real drive times for stops outside the bundled snapshot (one OSRM call)
      const read = Promise.all([conditions, ensureMatrix([depot, ...stops])]).then(([c, roadsOk]): Conditions =>
        roadsOk ? c : { ...c, notes: [...c.notes, 'OSRM did not respond, so drive times between new stops are estimated.'] },
      )
      const finish = (c: Conditions) => {
        if (token !== runToken.current) return
        const r = optimise(depot, c.stops, departure, PROFILES[profile].weights, c.rain, c.traffic)
        setPlanCond(c)
        setResult(r)
        if (!instant) setView('coldroute')
        setPhase('optimised')
        if (c.mode === 'live' && c.source === 'recorded') setToast('Live data unavailable · planned with the recorded morning')
        else if (!allReal([depot, ...c.stops])) setToast('OSRM did not respond · drive times are estimated')
        // road geometry for both plans' legs; the map redraws when it arrives
        const byId = Object.fromEntries(c.stops.map((s) => [s.id, s]))
        void ensureLegs([r.recommended.order, r.baseline.order].map((o) => [depot, ...o.map((id) => byId[id])]))
      }
      if (instant) {
        read.then(finish)
        return
      }
      setSelectedId(null)
      setPhase('optimising')
      setStep(0)
      OPTIMISE_STEPS.forEach((_, i) => {
        timers.current.push(window.setTimeout(() => setStep(i + 1), 340 * (i + 1)))
      })
      // the steps play out while the feeds load; whichever takes longer wins
      const shown = new Promise<void>((done) => timers.current.push(window.setTimeout(done, 340 * OPTIMISE_STEPS.length + 220)))
      Promise.all([read, shown]).then(([c]) => finish(c))
    },
    [depot, stops, departure, profile, dataMode],
  )

  // fetch real drive times as stops are added, so the estimate and the
  // optimiser do not wait for them later
  useEffect(() => {
    if (readOnly) return
    const t = window.setTimeout(() => void ensureMatrix([depot, ...stops]), 400)
    return () => window.clearTimeout(t)
  }, [depot, stops, readOnly])

  const loadSample = () => {
    timers.current.forEach(clearTimeout)
    runToken.current++
    setStops(SAMPLE_STOPS)
    setSavedDepot(DEPOT)
    setDeparture(DEPARTURE)
    setDataMode('recorded')
    setSelectedId(null)
    setResult(null)
    setPhase('draft')
    setToast('Sample run loaded · the recorded rainy morning')
  }

  // a share link (or ?state=results) opens on the optimised plan
  useEffect(() => {
    if (openOnResult) runOptimise(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // switching data mode on a finished plan re-plans it on the new data
  const modeRef = useRef(dataMode)
  useEffect(() => {
    if (modeRef.current === dataMode) return
    modeRef.current = dataMode
    if (phase === 'optimised' && !readOnly) runOptimise()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataMode])

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

  // a viewer's link keeps following what they look at, so reload restores it
  useEffect(() => {
    if (!readOnly) return
    const url = new URL(location.href)
    if (view === 'coldroute') url.searchParams.delete('view')
    else url.searchParams.set('view', view)
    if (selectedId) url.searchParams.set('stop', selectedId)
    else url.searchParams.delete('stop')
    history.replaceState(null, '', url)
  }, [readOnly, view, selectedId])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const buildLink = useCallback(
    (withView: boolean) => {
      const url = new URL(location.origin + location.pathname)
      url.searchParams.set('share', SHARE_TOKEN)
      if (withView && view !== 'coldroute') url.searchParams.set('view', view)
      if (withView && selectedId) url.searchParams.set('stop', selectedId)
      return url.toString()
    },
    [view, selectedId],
  )

  const share = () => {
    if (!readOnly) return setShareOpen((o) => !o)
    // viewers can pass the link on, but not change who has access
    const ok = () => setToast('Link copied · it opens this view for anyone with access')
    navigator.clipboard?.writeText(location.href).then(ok, ok)
  }

  const makeCopy = () => {
    setSavedStops(snapshotStops)
    setSavedDepot(DEPOT)
    setReadOnly(false)
    const url = new URL(location.href)
    for (const k of ['share', 'view', 'stop']) url.searchParams.delete(k)
    history.replaceState(null, '', url)
    setToast('Saved to your runs as “Morning run (copy)” · you can edit it now')
  }

  const selectedStop = selectedId ? stopById[selectedId] : null
  const liveCameras = shownCond.mode === 'live' && shownCond.source !== 'recorded' ? feeds.cameras.data?.cameras : undefined
  const viewLabel = phase === 'optimised' ? `${VIEW_LABEL[view]}${selectedStop ? ` · ${selectedStop.short}` : ''}` : undefined

  const status = readOnly ? (
    <StatusPill>
      <Eye size={11} strokeWidth={2.2} /> View only
    </StatusPill>
  ) : phase === 'draft' ? (
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

  const primary = readOnly ? (
    <Button variant="primary" icon={<Copy size={13} strokeWidth={2} />} onClick={makeCopy}>
      Make a copy
    </Button>
  ) : phase === 'optimised' ? (
    <Button
      variant="primary"
      icon={<Send size={13} strokeWidth={2} />}
      onClick={() => {
        const send = () => setToast(`Sent to Ahmad R. · ${stops.length} stops · first ETA ${result ? fmt(result.recommended.rows[0].arrival) : ''}`)
        if (user) send()
        else setSignIn({ reason: 'Sign in to send this run to the driver.', then: send })
      }}
    >
      Dispatch<span className="max-md:hidden"> to driver</span>
    </Button>
  ) : (
    <span title="Optimise the route first" className="inline-flex">
      <Button variant="primary" icon={<Send size={13} strokeWidth={2} />} disabled>
        Dispatch<span className="max-md:hidden"> to driver</span>
      </Button>
    </span>
  )

  const left =
    phase === 'optimised' && result ? (
      <ResultsPanel
        depot={depot}
        result={result}
        stops={stopById}
        stopList={shownCond.stops}
        view={view}
        setView={setView}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onEdit={
          readOnly
            ? undefined
            : () => {
                setSelectedId(null)
                setPhase('draft')
              }
        }
        onReoptimise={readOnly ? undefined : () => runOptimise()}
        profileLabel={PROFILES[profile].label}
        departure={departure}
        data={shownCond}
      />
    ) : (
      <StopsEditor
        depot={depot}
        setDepot={setSavedDepot}
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
        dateLabel={dataMode === 'live' ? todayLabel() : RECORDED_DATE_LABEL}
        onDepartNow={() => setDeparture(Math.min(23 * 60 + 55, Math.ceil(sgMinutes(Date.now()) / 5) * 5))}
        onLoadSample={loadSample}
        isSample={isSample}
        trafficLive={nowCond.traffic !== null}
      />
    )

  const card =
    phase === 'optimised' && result && selectedStop ? (
      <StopCard
        stop={selectedStop}
        result={result}
        names={names}
        departure={departure}
        rain={shownCond.rain}
        depotName={depot.name}
        camera={liveCameras ? camerasNear(liveCameras, selectedStop, 3, 1)[0] : undefined}
        onViewCamera={setCameraView}
        onClose={() => setSelectedId(null)}
        onEdit={readOnly ? undefined : () => setPhase('draft')}
        inline={isPhone}
      />
    ) : null

  const timeline =
    phase === 'optimised' && result ? (
      <Timeline
        result={result}
        stops={stopById}
        view={view}
        departure={departure}
        selectedId={selectedId}
        onSelect={setSelectedId}
        rain={shownCond.rain}
      />
    ) : null

  const map = (insetBottom: number) => (
    <MapView
      palette={theme.map}
      depot={depot}
      stops={shownCond.stops}
      rain={shownCond.rain}
      traffic={phase === 'optimised' ? shownCond.traffic : null}
      result={phase === 'optimised' ? result : null}
      view={view}
      phase={phase}
      selectedId={selectedId}
      onSelect={setSelectedId}
      layers={layers}
      setLayers={setLayers}
      insetLeft={0}
      insetBottom={insetBottom}
      cardOpen={!!card && !isPhone}
      compact={isPhone}
    >
      {!isPhone && card}
    </MapView>
  )

  const account = {
    user,
    onSignIn: () => setSignIn({}),
    onSignOut: () => {
      setUser(null)
      setToast('Signed out')
    },
  }

  const topBar = (
    <TopBar
      status={status}
      primary={primary}
      runDate={shownCond.mode === 'live' ? todayLabel(true) : undefined}
      data={
        <>
          <DataPill
            conditions={shownCond}
            loading={dataMode === 'live' && isLoading(feeds) && !feeds.weather.data}
            open={condOpen}
            onClick={() => setCondOpen((o) => !o)}
          />
          {condOpen && (
            <ConditionsPanel
              mode={dataMode}
              setMode={setDataMode}
              feeds={feeds}
              conditions={shownCond}
              stops={stops}
              onRefresh={() => refreshLive()}
              onClose={() => setCondOpen(false)}
              onViewCamera={setCameraView}
              covered={!!cameraView}
              locked={readOnly}
            />
          )}
        </>
      }
      onShare={share}
      sharePopover={
        shareOpen && <SharePopover viewLabel={viewLabel} buildLink={buildLink} onClose={() => setShareOpen(false)} notify={setToast} />
      }
      theme={{ mode: forcedTheme ?? themeMode, resolved: themeId, onChange: pickTheme }}
      panel={isPhone ? undefined : { collapsed, onToggle: () => setCollapsed((c) => !c) }}
      account={(isPhone || collapsed) && <AccountButton {...account} />}
    />
  )

  const sharedBanner = readOnly && (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-brand-soft px-4 py-2 text-[12.5px] text-fg-2 max-md:px-3">
      <span className="num flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-[9px] font-semibold text-on-brand">FL</span>
      <span className="min-w-0 truncate">
        <span className="font-medium text-fg">Fiona Lim</span> shared this run with you
        <span className="max-md:hidden"> · read-only snapshot, data from {hm(RECORDED_AT)}</span>
      </span>
    </div>
  )

  const signInDialog = signIn && (
    <SignInDialog
      reason={signIn.reason}
      onClose={() => setSignIn(null)}
      onSignedIn={(u) => {
        setUser(u)
        setSignIn(null)
        if (signIn.then) signIn.then()
        else setToast(`Signed in as ${u.name}`)
      }}
    />
  )

  const toastEl = toast && (
    <div
      role="status"
      className="animate-rise fixed bottom-6 left-1/2 z-[60] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-medium text-on-ink shadow-float max-md:top-16 max-md:bottom-auto"
    >
      <Check size={13} strokeWidth={2.5} className="shrink-0" /> <span className="truncate">{toast}</span>
    </div>
  )

  const cameraViewer = cameraView && (
    <CameraViewer key={cameraView.camera.image} view={cameraView} stops={shownCond.stops} onClose={() => setCameraView(null)} />
  )

  // Phone: full-bleed map with the panel in a bottom sheet
  if (isPhone) {
    const showTimeline = sheetTab === 'timeline' && !!timeline && !card
    return (
      <div className="flex h-full flex-col bg-canvas text-fg">
        {topBar}
        {sharedBanner}
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute inset-0">{map(sheetH)}</div>
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
                    label="Panel"
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
        {cameraViewer}
        {signInDialog}
        {toastEl}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      {topBar}
      {sharedBanner}
      <main className="flex min-h-0 flex-1">
        <aside
          inert={collapsed}
          aria-label="Run panel"
          style={{ width: collapsed ? 0 : panelW }}
          className={clsx(
            'relative flex shrink-0 flex-col bg-panel',
            collapsed ? 'overflow-hidden' : 'border-r border-line',
            !resizing && 'transition-[width] duration-200 ease-out',
          )}
        >
          {/* fixed inner width: the content slides out instead of re-wrapping */}
          <div className="flex h-full min-h-0 flex-col overflow-hidden" style={{ width: panelW }}>
            <div className="flex min-h-0 flex-1 flex-col">{left}</div>
            <AccountBar {...account} />
          </div>
          {!collapsed && (
            <PanelHandle width={panelW} setWidth={setPanelW} onCollapse={() => setCollapsed(true)} onDragChange={setResizing} />
          )}
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">{map(0)}</div>
          {timeline && <div className="h-[236px] shrink-0 border-t border-line bg-panel">{timeline}</div>}
        </section>
      </main>
      {cameraViewer}
      {signInDialog}
      {toastEl}
    </div>
  )
}

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`
