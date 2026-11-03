import { useEffect, useSyncExternalStore } from 'react'
import type { TypicalTraffic } from './conditions'
import {
  type Feed,
  FEED_URLS,
  type Json,
  type LiveFeeds,
  type LtaCarparkFeed,
  parseCameras,
  parseCarparks,
  parseLtaCarparks,
  parseWeather,
} from './feeds'
import { parseTrafficGrid, type TrafficGrid } from './traffic'

export * from './feeds'

/**
 * Live public feeds, read straight from data.gov.sg in the browser. All three
 * are open (no key) and send `Access-Control-Allow-Origin: *`, so the console
 * needs no backend for them. The backend's /api/data/* routes read the same
 * feeds; once our own API is deployed this file is the one place to switch.
 */

/**
 * Live road speeds come from our own backend, because LTA's AccountKey must
 * stay on a server (backend/app/services/traffic.py). Without this URL the
 * console does not measure traffic, and says so.
 */
export const TRAFFIC_URL: string | undefined = import.meta.env.VITE_TRAFFIC_URL || undefined
/** Typical traffic for a departure lives next to the live grid: /api/traffic/typical?at=… */
export const TYPICAL_TRAFFIC_URL = TRAFFIC_URL?.replace(/\/grid$/, '/typical')
/**
 * URA and mall carparks with their free car lots: LTA DataMall, through our
 * backend because of the key (backend/app/services/parking.py). HDB carparks
 * come straight from data.gov.sg.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || undefined
export const PARKING_URL = API_BASE ? `${API_BASE}/api/parking/carparks` : undefined

/** How often Live mode refetches while the tab is open. */
export const REFRESH_MS = 5 * 60_000

async function getJson(url: string, ms = 12_000): Promise<Json> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) {
      // our backend says why in `detail` (e.g. no LTA key); the public feeds only send a status
      const body = (await res.json().catch(() => null)) as { detail?: unknown } | null
      throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`)
    }
    return (await res.json()) as Json
  } catch (e) {
    throw new Error(ctl.signal.aborted ? 'Timed out' : e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}

// ---- shared store ----------------------------------------------------------

let state: LiveFeeds = {
  weather: { status: 'idle' },
  carparks: { status: 'idle' },
  ltaCarparks: { status: 'idle' },
  cameras: { status: 'idle' },
  traffic: { status: 'idle' },
}
const listeners = new Set<() => void>()
const emit = (next: LiveFeeds) => {
  state = next
  listeners.forEach((l) => l())
}
let inflight: Promise<LiveFeeds> | null = null

const settle = <T,>(prev: Feed<T>, r: PromiseSettledResult<T>): Feed<T> =>
  r.status === 'fulfilled'
    ? { status: 'ok', data: r.value }
    : // keep the last good values so a flaky refresh does not blank the panel
      { status: 'error', data: prev.data, error: r.reason instanceof Error ? r.reason.message : String(r.reason) }

/** Fetch every feed now (one request each; concurrent callers share it). */
export function refreshLive(): Promise<LiveFeeds> {
  if (inflight) return inflight
  const loading = <T,>(f: Feed<T>): Feed<T> => ({ ...f, status: 'loading' })
  emit({
    ...state,
    weather: loading(state.weather),
    carparks: loading(state.carparks),
    cameras: loading(state.cameras),
    traffic: TRAFFIC_URL ? loading(state.traffic) : state.traffic,
    ltaCarparks: PARKING_URL ? loading(state.ltaCarparks ?? { status: 'idle' }) : state.ltaCarparks,
  })
  inflight = Promise.allSettled([
    getJson(FEED_URLS.weather).then(parseWeather),
    getJson(FEED_URLS.carparks).then(parseCarparks),
    getJson(FEED_URLS.cameras).then(parseCameras),
    // a cold backend reads ~100 LTA pages before answering, so allow it longer
    TRAFFIC_URL ? getJson(TRAFFIC_URL, 30_000).then(parseTrafficGrid) : Promise.resolve(null),
    PARKING_URL ? getJson(PARKING_URL).then(parseLtaCarparks) : Promise.resolve(null),
  ]).then(([w, c, cam, t, lta]) => {
    emit({
      weather: settle(state.weather, w),
      carparks: settle(state.carparks, c),
      cameras: settle(state.cameras, cam),
      traffic: TRAFFIC_URL ? settle(state.traffic, t as PromiseSettledResult<TrafficGrid>) : state.traffic,
      ltaCarparks: PARKING_URL ? settle(state.ltaCarparks ?? { status: 'idle' }, lta as PromiseSettledResult<LtaCarparkFeed>) : state.ltaCarparks,
      fetchedAt: Date.now(),
    })
    inflight = null
    return state
  })
  return inflight
}

/** The current feeds if they are fresh enough, otherwise a new fetch. */
export function ensureLive(maxAgeMs = 60_000): Promise<LiveFeeds> {
  if (inflight) return inflight
  if (state.fetchedAt && Date.now() - state.fetchedAt < maxAgeMs && state.weather.status === 'ok') return Promise.resolve(state)
  return refreshLive()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/**
 * The live feeds. While `active`, fetches once (if stale) and then every five
 * minutes; a hidden tab skips refreshes until it is visible again.
 */
export function useLiveFeeds(active: boolean) {
  const feeds = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    if (!active) return
    ensureLive(REFRESH_MS)
    const timer = window.setInterval(() => document.visibilityState === 'visible' && refreshLive(), REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && ensureLive(REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])
  return feeds
}

export const isLoading = (f: LiveFeeds) =>
  f.weather.status === 'loading' ||
  f.carparks.status === 'loading' ||
  f.cameras.status === 'loading' ||
  f.traffic.status === 'loading' ||
  f.ltaCarparks?.status === 'loading'

const typicalCache = new Map<string, Promise<TypicalTraffic>>()

/**
 * Typical traffic for a run leaving at `departure` (minutes after midnight)
 * today in Singapore, or the backend's reason there is none. Asked once per
 * departure; the backend rebuilds the grids each night.
 */
export function typicalTraffic(departure: number, now = Date.now()): Promise<TypicalTraffic> {
  if (!TYPICAL_TRAFFIC_URL) return Promise.resolve({ grid: null })
  const at = singaporeTime(departure, now)
  let hit = typicalCache.get(at)
  if (!hit) {
    hit = getJson(`${TYPICAL_TRAFFIC_URL}?at=${encodeURIComponent(at)}`, 15_000)
      .then((raw) => ({ grid: parseTrafficGrid(raw) }))
      .catch((e: unknown) => {
        // a failure or a slot not built yet is not kept: the next plan asks again
        typicalCache.delete(at)
        return { grid: null, reason: e instanceof Error ? e.message : String(e) }
      })
    typicalCache.set(at, hit)
  }
  return hit
}

/** Today's date in Singapore at `minutes` after midnight, as ISO with the +08:00 offset. */
export function singaporeTime(minutes: number, now = Date.now()) {
  const date = new Date(now + 8 * 3600_000).toISOString().slice(0, 10)
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  return `${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00+08:00`
}
