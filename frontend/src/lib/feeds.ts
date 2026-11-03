/**
 * The live public feeds: their shapes and their parsers. Pure functions without
 * React, so the cloud planner (planner/) reads the same feeds the same way as
 * the console (live.ts fetches them in the browser).
 */
import type { TrafficGrid } from './traffic'

const BASE = 'https://api.data.gov.sg/v1'
export const FEED_URLS = {
  weather: `${BASE}/environment/2-hour-weather-forecast`,
  carparks: `${BASE}/transport/carpark-availability`,
  cameras: `${BASE}/transport/traffic-images`,
} as const

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
  /** when our backend read LTA, epoch ms: lots this old are no longer live (conditions.ts) */
  fetchedAt: number
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

export type Json = Record<string, unknown>
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
  return { updated: sgMinutes(raw.fetchedAt), fetchedAt: Date.parse(raw.fetchedAt), carparks }
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
