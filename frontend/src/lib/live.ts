import { useEffect, useSyncExternalStore } from 'react'

/**
 * Live public feeds, read straight from data.gov.sg in the browser. All three
 * are open (no key) and send `Access-Control-Allow-Origin: *`, so the console
 * needs no backend for them. The backend's /api/data/* routes read the same
 * feeds; once our own API is deployed this file is the one place to switch.
 */
const BASE = 'https://api.data.gov.sg/v1'
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

export interface LiveFeeds {
  weather: Feed<WeatherFeed>
  carparks: Feed<CarparkFeed>
  cameras: Feed<CameraFeed>
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

export function parseCameras(raw: Json): CameraFeed {
  const item = arr(raw.items)[0] as Json | undefined
  if (!item) throw new Error('No cameras in the response')
  const cameras = arr(item.cameras).map((c) => {
    const loc = c.location as { latitude: number; longitude: number }
    return { id: String(c.camera_id), lng: loc.longitude, lat: loc.latitude, image: c.image as string, taken: sgMinutes(c.timestamp as string) }
  })
  return { updated: sgMinutes(item.timestamp as string), cameras }
}

async function getJson(url: string, ms = 12_000): Promise<Json> {
  const ctl = new AbortController()
  const timer = window.setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as Json
  } catch (e) {
    throw new Error(ctl.signal.aborted ? 'Timed out' : e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}

// ---- shared store ----------------------------------------------------------

let state: LiveFeeds = { weather: { status: 'idle' }, carparks: { status: 'idle' }, cameras: { status: 'idle' } }
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

/** Fetch all three feeds now (one request each; concurrent callers share it). */
export function refreshLive(): Promise<LiveFeeds> {
  if (inflight) return inflight
  const loading = <T,>(f: Feed<T>): Feed<T> => ({ ...f, status: 'loading' })
  emit({ ...state, weather: loading(state.weather), carparks: loading(state.carparks), cameras: loading(state.cameras) })
  inflight = Promise.allSettled([
    getJson(FEED_URLS.weather).then(parseWeather),
    getJson(FEED_URLS.carparks).then(parseCarparks),
    getJson(FEED_URLS.cameras).then(parseCameras),
  ]).then(([w, c, cam]) => {
    emit({
      weather: settle(state.weather, w),
      carparks: settle(state.carparks, c),
      cameras: settle(state.cameras, cam),
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

export const isLoading = (f: LiveFeeds) => f.weather.status === 'loading' || f.carparks.status === 'loading' || f.cameras.status === 'loading'
