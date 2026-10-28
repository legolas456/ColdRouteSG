import clsx from 'clsx'
import { Cctv, CloudRain, CloudSun, Gauge, Loader2, Maximize2, RefreshCw, SquareParking, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { RECORDED_AT, RECORDED_DATE } from '../data/sample'
import { camerasNear, MAX_WALK_KM, type Conditions, type DataMode } from '../lib/conditions'
import { nearest } from '../lib/geo'
import { isLoading, sgMinutes, TRAFFIC_URL, type Camera, type Feed, type LiveFeeds } from '../lib/live'
import { hm } from '../lib/time'
import type { Stop } from '../lib/types'
import type { CameraView } from './CameraViewer'
import { Segmented } from './ui'

interface Props {
  mode: DataMode
  setMode: (m: DataMode) => void
  feeds: LiveFeeds
  /** what the current (or next) plan reads */
  conditions: Conditions
  stops: Stop[]
  onRefresh: () => void
  onClose: () => void
  /** show a camera image large, in the console */
  onViewCamera: (v: CameraView) => void
  /** a dialog (the camera viewer) sits on top: leave Esc and outside clicks to it */
  covered?: boolean
  /** view-only runs keep the snapshot they were shared with */
  locked?: boolean
}

const fmt = (n: number) => n.toLocaleString('en-SG')

/**
 * What the plan is built on, and the live public feeds behind it. Opens from
 * the data pill in the top bar. The feeds always show what is live now, even
 * when the plan replays the recorded morning.
 */
export function ConditionsPanel({ mode, setMode, feeds, conditions, stops, onRefresh, onClose, onViewCamera, covered, locked }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const coveredRef = useRef(covered)
  coveredRef.current = covered

  useEffect(() => {
    // the wrapper also holds the pill, so clicking it toggles instead of re-opening
    const wrap = ref.current?.parentElement
    const onDown = (e: MouseEvent) => !coveredRef.current && wrap && !wrap.contains(e.target as Node) && closeRef.current()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || coveredRef.current) return
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  const loading = isLoading(feeds)
  const fetched = feeds.fetchedAt ? hm(sgMinutes(feeds.fetchedAt)) : null

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Conditions"
      className="animate-rise scroll-thin absolute top-11 right-0 z-50 max-h-[calc(100dvh-72px)] w-[420px] overflow-y-auto rounded-panel bg-panel shadow-float max-md:fixed max-md:inset-x-2 max-md:top-[60px] max-md:w-auto"
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">Conditions</div>
            <p className="mt-0.5 text-[12px] text-fg-3">Weather, parking and traffic the plan is built on.</p>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="-mt-0.5 -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        {!locked && (
          <div className="mt-3">
            <Segmented<DataMode>
              label="Plan with"
              size="sm"
              className="w-full"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'live', label: 'Live data', title: 'Plan with the NEA forecast and HDB lots fetched now' },
                { value: 'recorded', label: `Recorded · ${RECORDED_DATE}`, title: 'Replay the recorded rainy morning (sample data)' },
              ]}
            />
          </div>
        )}
        <p className="mt-2 text-[12px] leading-relaxed text-fg-2">
          {mode === 'recorded' || locked ? (
            <>
              The plan replays a rainy morning recorded on {RECORDED_DATE} at <span className="num">{hm(RECORDED_AT)}</span>: heavy rain over the
              City from <span className="num">10:30</span> to <span className="num">11:15</span>. It is sample data, kept fixed so the demo case never
              changes.
            </>
          ) : conditions.source === 'recorded' ? (
            <>Live data could not be read, so the plan uses the recorded morning for now.</>
          ) : (
            <>
              The plan reads the NEA forecast{conditions.traffic ? ', HDB free lots and LTA road speeds' : ' and HDB free lots'} fetched at{' '}
              <span className="num">{hm(conditions.at)}</span>. Re-optimise to pick up newer data; the feeds below refresh every 5 minutes.
              {conditions.cloud && (
                <>
                  {' '}
                  It was planned on AWS Lambda in <span className="num">{(conditions.cloud.ms / 1000).toFixed(1)} s</span>
                  {conditions.cloud.roads === 'location' && ', with drive times from Amazon Location Service'}.
                </>
              )}
            </>
          )}
        </p>
        {!locked &&
          conditions.notes.map((n) => (
            <p key={n} className="mt-1.5 flex items-start gap-1.5 text-[12px] text-fg-2">
              <TriangleAlert size={13} className="mt-[2px] shrink-0 text-warn" /> {n}
            </p>
          ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-4 pt-3 pb-1.5">
        <span className="eyebrow">Live public feeds</span>
        <span className="flex items-center gap-2">
          <span className="num text-[10.5px] text-fg-4">{loading ? 'Updating…' : fetched ? `data.gov.sg · ${fetched}` : 'data.gov.sg'}</span>
          <button
            aria-label="Refresh the feeds"
            title="Refresh the feeds"
            onClick={onRefresh}
            disabled={loading}
            className="flex size-6 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg disabled:opacity-50"
          >
            <RefreshCw size={13} className={clsx(loading && 'animate-spin')} />
          </button>
        </span>
      </div>

      {(mode === 'recorded' || locked) && (
        <p className="px-4 pb-1.5 text-[11.5px] text-fg-3">What is live right now, for reference. {locked ? '' : 'Switch to Live data to plan with it.'}</p>
      )}
      <div className="space-y-2 px-3 pb-3">
        <WeatherSection feed={feeds.weather} stops={stops} />
        <ParkingSection feed={feeds.carparks} lta={feeds.ltaCarparks} stops={stops} />
        <RoadSpeedSection feed={feeds.traffic} usedByPlan={conditions.traffic !== null} />
        <CameraSection feed={feeds.cameras} stops={stops} onView={onViewCamera} />
      </div>
    </div>
  )
}

function Section<T>({
  icon: Icon,
  title,
  source,
  feed,
  updated,
  failed = (error) => <p className="text-[12px] text-fg-3">Could not reach data.gov.sg ({error}). Try Refresh.</p>,
  off,
  children,
}: {
  icon: LucideIcon
  title: string
  source: string
  feed: Feed<T>
  updated?: number
  /** what to say when the feed failed and there is no earlier data */
  failed?: (error?: string) => ReactNode
  /** shown instead of a loading placeholder when the feed is not set up */
  off?: ReactNode
  children: ReactNode
}) {
  const isOff = off !== undefined && feed.status === 'idle' && !feed.data
  return (
    <section className="rounded-[10px] px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--border-main)]">
      <div className="flex items-center gap-2">
        <Icon size={14} strokeWidth={1.8} className="shrink-0 text-fg-2" />
        <span className="text-[12.5px] font-medium">{title}</span>
        <span className="num truncate text-[9.5px] tracking-[0.04em] text-fg-4 uppercase">{source}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px]">
          {isOff ? (
            <span className="text-fg-3">Off</span>
          ) : feed.status === 'loading' && !feed.data ? (
            <>
              <Loader2 size={11} className="animate-spin text-fg-3" /> <span className="text-fg-3">Loading</span>
            </>
          ) : feed.status === 'error' ? (
            <span className="flex items-center gap-1 text-bad" title={feed.error}>
              <span className="size-1.5 rounded-full bg-bad" /> {feed.data ? 'Stale' : 'Unavailable'}
            </span>
          ) : feed.data ? (
            <span className="flex items-center gap-1 text-fg-3">
              <span className="size-1.5 rounded-full bg-ok" />
              <span className="num">{updated !== undefined ? hm(updated) : ''}</span>
            </span>
          ) : null}
        </span>
      </div>
      <div className="mt-2">
        {feed.data ? (
          children
        ) : isOff ? (
          off
        ) : feed.status === 'error' ? (
          failed(feed.error)
        ) : (
          <div className="h-9 animate-pulse rounded-md bg-hover" />
        )}
      </div>
    </section>
  )
}

function WeatherSection({ feed, stops }: { feed: LiveFeeds['weather']; stops: Stop[] }) {
  const w = feed.data
  const wet = w?.areas.filter((a) => a.rain > 0) ?? []
  // which NEA area each stop falls in, so the list leads with the run's areas
  const atStops = useMemo(() => {
    if (!w) return []
    const seen = new Map<string, string[]>()
    for (const s of stops) {
      const a = nearest(w.areas, s)?.item
      if (a) seen.set(a.area, [...(seen.get(a.area) ?? []), s.short])
    }
    return w.areas.filter((a) => seen.has(a.area)).map((a) => ({ ...a, stops: seen.get(a.area)! }))
  }, [w, stops])
  return (
    <Section icon={wet.length ? CloudRain : CloudSun} title="Weather" source="NEA 2-hour forecast" feed={feed} updated={w?.updated}>
      {w && (
        <>
          <p className="text-[12px] text-fg-2">
            {wet.length ? (
              <>
                Rain forecast in {listNames(wet.map((a) => a.area))}
              </>
            ) : (
              <>No rain forecast in any of the {w.areas.length} areas</>
            )}
            <span className="text-fg-3">
              {' '}
              · valid <span className="num">{hm(w.validFrom)}–{hm(w.validTo)}</span>
            </span>
          </p>
          {atStops.length > 0 && (
            <ul className="mt-2 grid grid-cols-2 gap-1">
              {atStops.map((a) => (
                <li
                  key={a.area}
                  title={`${a.area}: ${a.forecast} (${a.stops.join(', ')})`}
                  className={clsx('min-w-0 rounded-md px-2 py-1 text-[11.5px]', a.rain ? 'bg-rain-soft text-fg' : 'bg-subtle text-fg-2')}
                >
                  <span className="block truncate font-medium">{a.area}</span>
                  <span className={clsx('block truncate', a.rain ? 'text-rain' : 'text-fg-3')}>{a.forecast}</span>
                </li>
              ))}
            </ul>
          )}
          <details className="group mt-2">
            <summary className="cursor-pointer list-none text-[11.5px] font-medium text-fg-3 hover:text-fg [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Show all {w.areas.length} areas</span>
              <span className="hidden group-open:inline">Hide areas</span>
            </summary>
            <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
              {w.areas.map((a) => (
                <li key={a.area} className="flex min-w-0 items-baseline justify-between gap-2 text-[11px]">
                  <span className="truncate text-fg-2">{a.area}</span>
                  <span className={clsx('shrink-0 truncate', a.rain ? 'font-medium text-rain' : 'text-fg-4')}>{a.forecast}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Section>
  )
}

function ParkingSection({ feed, lta, stops }: { feed: LiveFeeds['carparks']; lta: LiveFeeds['ltaCarparks']; stops: Stop[] }) {
  const c = feed.data
  const atStops = useMemo(() => (c ? stops.map((s) => ({ stop: s, ...nearest(c.carparks, s)! })).filter((r) => r.item) : []), [c, stops])
  return (
    <Section icon={SquareParking} title="Carparks" source="HDB availability" feed={feed} updated={c?.updated}>
      {c && (
        <>
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md bg-line">
            <Stat label="Carparks" value={fmt(c.reporting)} />
            <Stat label="Free lots" value={fmt(c.freeLots)} />
            <Stat label="Free" value={`${((c.freeLots / c.totalLots) * 100).toFixed(1)}%`} />
          </dl>
          {lta?.data && lta.data.carparks.length > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-fg-3">
              Plus <span className="num">{fmt(lta.data.carparks.length)}</span> URA and mall carparks with{' '}
              <span className="num">{fmt(lta.data.carparks.reduce((sum, p) => sum + p.free, 0))}</span> free lots (LTA). A stop uses whichever
              carpark is nearest.
            </p>
          )}
          {atStops.length > 0 && (
            <>
              <div className="mt-2 text-[11px] text-fg-3">Nearest HDB carpark to each stop</div>
              <ul className="mt-1 space-y-0.5">
                {atStops.map(({ stop, item, km }) => {
                  const pct = Math.round((item.free / item.total) * 100)
                  const far = km > MAX_WALK_KM
                  return (
                    <li
                      key={stop.id}
                      className={clsx('grid grid-cols-[minmax(0,88px)_1fr_auto] items-baseline gap-2 text-[11.5px]', far && 'text-fg-4')}
                      title={far ? `${item.address}: over ${MAX_WALK_KM * 1000} m away, so the plan keeps the stop's own loading bay` : item.address}
                    >
                      <span className="truncate font-medium">{stop.short}</span>
                      <span className={clsx('truncate', !far && 'text-fg-3')}>
                        <span className="num">{item.no}</span> · {distanceLabel(km)}
                      </span>
                      {far ? (
                        <span>own loading bay</span>
                      ) : (
                        <span className={clsx('num', pct < 15 ? 'text-bad' : 'text-fg-2')}>
                          {item.free}/{item.total} free
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </>
      )}
    </Section>
  )
}

type CameraPick = { camera: Camera; stop?: Stop; km?: number }

function CameraSection({ feed, stops, onView }: { feed: LiveFeeds['cameras']; stops: Stop[]; onView: (v: CameraView) => void }) {
  const cams = feed.data
  // the camera nearest each stop (within 4 km, never twice), then whatever else
  // is online: LTA sometimes serves only a handful of cameras
  const shown = useMemo<CameraPick[]>(() => {
    if (!cams) return []
    const near: CameraPick[] = []
    for (const s of stops) {
      const hit = camerasNear(cams.cameras, s, 4, 3).find((c) => !near.some((p) => p.camera.id === c.camera.id))
      if (hit) near.push({ stop: s, ...hit })
    }
    near.sort((a, b) => (a.km ?? 0) - (b.km ?? 0))
    const rest = cams.cameras.filter((c) => !near.some((p) => p.camera.id === c.id)).map((camera) => ({ camera }))
    return [...near, ...rest].slice(0, 4)
  }, [cams, stops])
  return (
    <Section icon={Cctv} title="Traffic cameras" source="LTA" feed={feed} updated={cams?.updated}>
      {cams && (
        <>
          {shown.length ? (
            <ul className="grid grid-cols-2 gap-2">
              {shown.map(({ camera, stop, km }) => (
                <li key={camera.id}>
                  <button
                    type="button"
                    onClick={() => onView({ camera, stop: stop && km !== undefined ? { name: stop.name, km } : undefined })}
                    title={`Camera ${camera.id}${camera.place ? ` · ${camera.place}` : ''}${stop && km !== undefined ? `, ${distanceLabel(km)} from ${stop.name}` : ''}. Click to enlarge.`}
                    className="group block w-full rounded-md text-left"
                  >
                    <span className="relative block aspect-video overflow-hidden rounded-md bg-subtle shadow-[inset_0_0_0_1px_var(--border-main)]">
                      <img
                        src={camera.image}
                        alt={`LTA camera ${camera.id}`}
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      />
                      <Maximize2
                        size={12}
                        className="absolute top-1.5 right-1.5 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100"
                      />
                    </span>
                    <span className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="truncate text-fg-2">
                        {stop && km !== undefined ? (
                          <>
                            Near <span className="font-medium text-fg">{stop.short}</span> · {distanceLabel(km)}
                          </>
                        ) : (
                          <>{camera.place ?? `Camera ${camera.id}`}</>
                        )}
                      </span>
                      <span className="num shrink-0 text-fg-4">{hm(camera.taken)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-fg-3">No cameras online right now.</p>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-fg-3">
            {cams.cameras.length} {cams.cameras.length === 1 ? 'camera' : 'cameras'} online. The images are for context; they do not change the
            plan.
          </p>
        </>
      )}
    </Section>
  )
}

function RoadSpeedSection({ feed, usedByPlan }: { feed: LiveFeeds['traffic']; usedByPlan: boolean }) {
  const g = feed.data
  return (
    <Section
      icon={Gauge}
      title="Road speeds"
      source="LTA speed bands"
      feed={feed}
      updated={g?.at}
      failed={(error) => (
        <p className="text-[12px] leading-relaxed text-fg-3">
          {/* the backend's reasons are sentences (e.g. no LTA key); network failures are bare phrases */}
          {error?.endsWith('.') ? error : `The ColdRoute traffic service did not answer (${error ?? 'no response'}).`} Drive times assume free-flowing
          traffic.
        </p>
      )}
      off={
        TRAFFIC_URL ? undefined : (
          <p className="text-[12px] leading-relaxed text-fg-3">
            Not set up: live road speeds need the ColdRoute traffic service, which holds the LTA key. Drive times assume free-flowing traffic.
          </p>
        )
      }
    >
      {g && (
        <>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-line">
            <Stat label="Road stretches" value={fmt(g.stretches)} />
            <Stat label="Slow (1.5× or worse)" value={`${Math.round(g.slowShare * 100)}%`} />
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-3">
            {usedByPlan
              ? 'The plan stretches each drive by how much slower the roads along it are now than at night.'
              : 'Not used for this plan: see the note above.'}
          </p>
        </>
      )}
    </Section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-subtle px-2 py-1.5">
      <dt className="text-[10px] text-fg-3">{label}</dt>
      <dd className="num mt-0.5 text-[13px] font-medium">{value}</dd>
    </div>
  )
}

const listNames = (names: string[]) => {
  if (names.length <= 3) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

/** 84 m, 1.2 km */
export const distanceLabel = (km: number) => (km < 1 ? `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m` : `${km.toFixed(1)} km`)
