import { useEffect, useSyncExternalStore } from 'react'
import type { TypicalTraffic } from './conditions'
import { parseTrafficGrid, type TrafficGrid } from './traffic'

/**
 * Live public feeds, read straight from data.gov.sg in the browser. All three
 * are open (no key) and send `Access-Control-Allow-Origin: *`, so the console
 * needs no backend for them. The backend's /api/data/* routes read the same
 * feeds; once our own API is deployed this file is the one place to switch.
 */
const BASE = 'https://api.data.gov.sg/v1'

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
export const FEED_URLS = {
  weather: `${BASE}/environment/2-hour-weather-forecast`,
  carparks: `${BASE}/transport/carpark-availability`,
  cameras: `${BASE}/transport/traffic-images`,
} as const

/** How often Live mode refetches while the tab is open. */
export const REFRESH_MS = 5 * 60_000

export type RainLevel = 0 | 1 | 2

export interface WeatherArea {
  area: string
  /** NEA wording, tidied: "Thundery showers", "Partly cloudy" */
  forecast: string
  lng: number
  lat: number
  /** 0 dry, 1 rain or showers, 2 heavy or thundery */
  rain: RainLevel
}

export interface WeatherFeed {
  /** minutes after midnight, Singapore time */
  updated: number
  validFrom: number
  validTo: number
  areas: WeatherArea[]
}

export interface LiveCarpark {
  no: string
  address: string
  lng: number
  lat: number
  free: number
  total: number
}

export interface CarparkFeed {
  updated: number
  /** carparks that report live lots, with their position from the HDB snapshot */
  carparks: LiveCarpark[]
  reporting: number
  totalLots: number
  freeLots: number
}

export interface Camera {
  id: string
  lng: number
  lat: number
  image: string
  taken: number
  /** what the camera looks at, when LTA names it (see CAMERA_PLACES) */
  place?: string
}

/**
 * What each camera looks at, from LTA's OneMotoring traffic cameras page
 * (October 2026). The data.gov.sg feed only has ids and positions; cameras not
 * listed here are described by their nearest NEA area instead.
 */
export const CAMERA_PLACES: Record<string, string> = {
  '2701': 'Woodlands Causeway (towards Johor)',
  '2702': 'Woodlands Checkpoint (towards BKE)',
  '2704': 'Woodlands Flyover (towards Checkpoint)',
  '4703': 'Second Link at Tuas',
  '4712': 'After Tuas West Road',
  '4713': 'Tuas Checkpoint',
  '4798': 'Sentosa Gateway (towards Telok Blangah)',
  '4799': 'Sentosa Gateway (towards Sentosa)',
}

export interface CameraFeed {
  updated: number
  cameras: Camera[]
}

export interface Feed<T> {
  status: 'idle' | 'loading' | 'ok' | 'error'
  data?: T
  error?: string
}

/** A URA or mall carpark: LTA reports its free car lots, not its size. */
export interface LtaCarpark {
  no: string
  address: string
  lng: number
  lat: number
  free: number
  agency: 'URA' | 'LTA'
}
export interface LtaCarparkFeed {
  updated: number
  carparks: LtaCarpark[]
}
export interface LiveFeeds {
  weather: Feed<WeatherFeed>
  carparks: Feed<CarparkFeed>
  /** URA and mall carparks; stays idle when PARKING_URL is not set */
  ltaCarparks?: Feed<LtaCarparkFeed>
  cameras: Feed<CameraFeed>
  /** stays idle when TRAFFIC_URL is not set */
  traffic: Feed<TrafficGrid>
  /** when the last fetch finished, epoch ms */
  fetchedAt?: number
}

// ---- parsing -------------------------------------------------------------

/** ISO time with an offset to minutes after midnight in Singapore (UTC+8, no DST). */
export function sgMinutes(iso: string | number | Date) {
  const d = new Date(iso)
  return ((d.getUTCHours() + 8) % 24) * 60 + d.getUTCMinutes()
}

export const rainLevel = (forecast: string): RainLevel =>
  /thunder|heavy/i.test(forecast) ? 2 : /rain|shower|drizzle/i.test(forecast) ? 1 : 0

const tidy = (forecast: string) => {
  const s = forecast.replace(/\s*\((day|night)\)/i, '').trim().toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

type Json = Record<string, unknown>
const arr = (v: unknown) => (Array.isArray(v) ? (v as Json[]) : [])

export function parseWeather(raw: Json): WeatherFeed {
  const item = arr(raw.items)[0] as Json | undefined
  const meta = arr(raw.area_metadata)
  if (!item || !meta.length) throw new Error('No forecast in the response')
  const where = Object.fromEntries(
    meta.map((m) => {
      const loc = m.label_location as { latitude: number; longitude: number }
      return [m.name as string, { lng: loc.longitude, lat: loc.latitude }]
    }),
  )
  const period = item.valid_period as { start: string; end: string }
  const validFrom = sgMinutes(period.start)
  let validTo = sgMinutes(period.end)
  if (validTo <= validFrom) validTo += 24 * 60
  const areas = arr(item.forecasts)
    .filter((f) => where[f.area as string])
    .map((f) => ({
      area: f.area as string,
      forecast: tidy(f.forecast as string),
      ...where[f.area as string],
      rain: rainLevel(f.forecast as string),
    }))
  return { updated: sgMinutes((item.update_timestamp ?? item.timestamp) as string), validFrom, validTo, areas }
}

type HdbRow = [string, string, number, number]
let hdbIndex: Promise<HdbRow[]> | null = null
/** Carpark positions (a snapshot: they rarely move). Loaded only when Live mode needs it. */
export const loadHdb = () => (hdbIndex ??= import('../data/hdb-carparks.json').then((m) => m.default.carparks as HdbRow[]))

export async function parseCarparks(raw: Json): Promise<CarparkFeed> {
  const item = arr(raw.items)[0] as Json | undefined
  if (!item) throw new Error('No carpark data in the response')
  const lots: Record<string, { free: number; total: number }> = {}
  let totalLots = 0
  let freeLots = 0
  for (const c of arr(item.carpark_data)) {
    const info = arr(c.carpark_info)
    // vans use car lots; fall back to every lot type when a carpark has none
    const cars = info.filter((i) => i.lot_type === 'C')
    const use = cars.length ? cars : info
    const total = use.reduce((s, i) => s + Number(i.total_lots || 0), 0)
    const free = use.reduce((s, i) => s + Math.max(0, Number(i.lots_available || 0)), 0)
    if (total <= 0) continue
    lots[c.carpark_number as string] = { free: Math.min(free, total), total }
    totalLots += total
    freeLots += Math.min(free, total)
  }
  const index = await loadHdb()
  const carparks = index.filter(([no]) => lots[no]).map(([no, address, lng, lat]) => ({ no, address, lng, lat, ...lots[no] }))
  return { updated: sgMinutes(item.timestamp as string), carparks, reporting: Object.keys(lots).length, totalLots, freeLots }
}

/** Our backend's carpark feed (GET /api/parking/carparks). */
export function parseLtaCarparks(raw: Json): LtaCarparkFeed {
  if (typeof raw.fetchedAt !== 'string' || Number.isNaN(Date.parse(raw.fetchedAt))) throw new Error('Unexpected carpark feed (fetchedAt)')
  const carparks = arr(raw.carparks).flatMap((c): LtaCarpark[] => {
    const { agency, lng, lat, free } = c
    if ((agency !== 'URA' && agency !== 'LTA') || typeof lng !== 'number' || typeof lat !== 'number' || typeof free !== 'number') return []
    return [{ no: String(c.id ?? ''), address: String(c.name ?? ''), lng, lat, free: Math.max(0, free), agency }]
  })
  return { updated: sgMinutes(raw.fetchedAt), carparks }
}

export function parseCameras(raw: Json): CameraFeed {
  const item = arr(raw.items)[0] as Json | undefined
  if (!item) throw new Error('No cameras in the response')
  const cameras = arr(item.cameras).map((c) => {
    const loc = c.location as { latitude: number; longitude: number }
    const id = String(c.camera_id)
    return { id, lng: loc.longitude, lat: loc.latitude, image: c.image as string, taken: sgMinutes(c.timestamp as string), place: CAMERA_PLACES[id] }
  })
  return { updated: sgMinutes(item.timestamp as string), cameras }
}

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
