// Address search with OneMap (Singapore Land Authority) and turning a result
// into a stop the optimiser can plan.
//
// The elastic search endpoint needs no token for basic results and allows
// cross-origin calls, so the browser queries it directly.
import neaAreas from '../data/nea-areas.json'
import { RAIN_CELLS } from '../data/sample'
import { MAX_WALK_KM } from './conditions'
import { nearest, parkingRisk } from './geo'
import { loadHdb } from './live'
import { hm } from './time'
import type { Carpark, Stop } from './types'

const ONEMAP = 'https://www.onemap.gov.sg/api/common/elastic/search'
/** One van, one run: the old console capped runs at 15 stops too. */
export const MAX_STOPS = 15

export interface Place {
  key: string
  name: string
  address: string
  postal: string
  lng: number
  lat: number
}

const ACRONYMS = new Set(['AMK', 'MSCP', 'HDB', 'NUH', 'NUS', 'SGH', 'CGH', 'KKH', 'TTSH', 'MBFC', 'NTU', 'SMU', 'ITE', 'MRT', 'LRT', 'JTC', 'PSA', 'CBD', 'UOB', 'OCBC', 'DBS', 'SIA', 'IKEA', 'NTUC', 'SAFRA', 'YMCA', 'ICA', 'MOE', 'MOH'])
const NOT_INITIALS = new Set(['st', 'mt', 'dr', 'rd', 'blk', 'bt', 'jln', 'ltd', 'bldg', 'cl', 'ct', 'pl', 'sq', 'nr', 'lr', 'pk'])
const ROAD_WORDS: Record<string, string> = { Road: 'Rd', Avenue: 'Ave', Street: 'St', Drive: 'Dr', Boulevard: 'Blvd', Crescent: 'Cres' }

/** "MARINA BAY FINANCIAL CENTRE (TOWER 3)" -> "Marina Bay Financial Centre (Tower 3)" */
export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s(/&-])([a-z])/g, (_, pre, c) => pre + c.toUpperCase())
    // known acronyms, and short words with no vowel ("Gv", "Ntuc") read as initials
    .replace(/\b[A-Za-z]+\b/g, (w) =>
      ACRONYMS.has(w.toUpperCase()) || (w.length >= 2 && w.length <= 4 && !/[aeiouy]/i.test(w) && !NOT_INITIALS.has(w.toLowerCase())) ? w.toUpperCase() : w,
    )
    // block suffixes: "2a" -> "2A"
    .replace(/\b(\d+)([a-z])\b/g, (_, n, l) => n + l.toUpperCase())

const shortRoad = (road: string) => road.replace(/\b(Road|Avenue|Street|Drive|Boulevard|Crescent)\b/g, (w) => ROAD_WORDS[w])
const real = (v: unknown) => (typeof v === 'string' && v && v !== 'NIL' ? v : '')

type OneMapRow = Record<string, string>

export function parseOneMap(rows: OneMapRow[]): Place[] {
  const out: Place[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const lat = Number(r.LATITUDE)
    const lng = Number(r.LONGITUDE)
    // Singapore only (OneMap occasionally returns 0,0 for retired addresses)
    if (!(lat > 1.15 && lat < 1.48 && lng > 103.6 && lng < 104.1)) continue
    const building = real(r.BUILDING) ? titleCase(r.BUILDING) : ''
    const blk = real(r.BLK_NO).toUpperCase()
    const road = real(r.ROAD_NAME) ? shortRoad(titleCase(r.ROAD_NAME)) : ''
    const postal = real(r.POSTAL)
    const street = [blk, road].filter(Boolean).join(' ')
    const name = building || (blk && road ? `Blk ${street}` : street || titleCase(r.SEARCHVAL ?? ''))
    const address = [street || titleCase(r.SEARCHVAL ?? ''), postal].filter(Boolean).join(', ')
    const key = `${postal}|${name}`
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push({ key, name, address, postal, lng: Math.round(lng * 1e6) / 1e6, lat: Math.round(lat * 1e6) / 1e6 })
  }
  return out
}

export const SEARCH_TIMEOUT_MS = 8000

/**
 * Up to 6 places for a building name, street or postal code. Cancelling
 * `signal` rejects with an AbortError (a newer query); a OneMap that does not
 * answer in SEARCH_TIMEOUT_MS rejects with an Error, so the UI can say so.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const url = `${ONEMAP}?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`
  const ctrl = new AbortController()
  const cancel = () => ctrl.abort()
  if (signal?.aborted) cancel()
  signal?.addEventListener('abort', cancel)
  const timer = setTimeout(() => ctrl.abort(new Error('OneMap did not answer in time')), SEARCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`OneMap answered ${res.status}`)
    const body = (await res.json()) as { results?: OneMapRow[] }
    return parseOneMap(body.results ?? []).slice(0, 6)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

const AREAS = (neaAreas.areas as Array<[string, number, number]>).map(([name, lng, lat]) => ({ name, lng, lat }))
/** The NEA forecast area a point belongs to (its nearest label point). */
export const neaAreaFor = (p: { lng: number; lat: number }) => nearest(AREAS, p)?.item.name ?? 'Singapore'

/** "Marina Bay Financial Centre (Tower 3)" -> "Marina Bay" for map labels. */
export function shortName(name: string) {
  const words = name.replace(/\s*\(.*?\)\s*/g, ' ').trim().split(/\s+/)
  let out = words[0] ?? name
  for (const w of words.slice(1)) {
    if ((out + ' ' + w).length > 14) break
    out += ' ' + w
  }
  return out
}


/**
 * A new stop at a OneMap place. The window opens at the departure (to the half
 * hour) and lasts four hours; cargo defaults to chilled. Everything is editable in the
 * stop row, which opens straight away.
 *
 * Weather: the stop's NEA area. In Recorded mode it gets the recorded rain if
 * its area had some, otherwise a dry forecast; Live mode replaces both.
 * Parking: the nearest HDB carpark within MAX_WALK_KM, otherwise the
 * building's own loading bay. Without live lots it assumes half are free.
 */
export async function stopFromPlace(place: Place, departure: number, taken: string[]): Promise<Stop> {
  const area = neaAreaFor(place)
  const cell = RAIN_CELLS.find((c) => c.area === area)
  let parking: Carpark = { name: 'Own loading bay', lng: place.lng, lat: place.lat, distanceKm: 0.05, freePct: 50, risk: parkingRisk(0.05, 50), estimated: true }
  try {
    const hdb = await loadHdb()
    const near = nearest(
      hdb.map(([no, address, lng, lat]) => ({ no, address, lng, lat })),
      place,
    )
    if (near && near.km <= MAX_WALK_KM) {
      const km = Math.round(near.km * 100) / 100
      parking = { name: near.item.address, code: near.item.no, lng: near.item.lng, lat: near.item.lat, distanceKm: km, freePct: 50, risk: parkingRisk(km, 50), estimated: true }
    }
  } catch {
    /* keep the loading bay */
  }
  const base = `P${place.postal || `${Math.round(place.lat * 1e4)}${Math.round(place.lng * 1e4)}`}`
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  const start = Math.min(22 * 60, Math.floor(departure / 30) * 30)
  return {
    id,
    name: place.name,
    short: shortName(place.name),
    address: place.address,
    lng: place.lng,
    lat: place.lat,
    windowStart: start,
    windowEnd: Math.min(23 * 60 + 59, start + 240),
    service: 10,
    cargo: 'CHILLED',
    area,
    forecast: cell ? `${cell.label} ${hm(cell.start)}–${hm(cell.end)}` : 'Partly cloudy',
    parking,
  }
}
