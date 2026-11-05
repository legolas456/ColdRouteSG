// Scenarios for the route-quality evaluation (see eval/README.md).
//
// Everything here is deterministic: the same seed always gives the same stops,
// windows, cargo and rain, and drive times come from one saved OSRM matrix
// (eval/fixtures/pool-matrix.json), so every planner sees identical inputs.

import hdb from '../src/data/hdb-carparks.json'
import neaAreas from '../src/data/nea-areas.json'
import { ADDRESS_BOOK, DEPOT, SAMPLE_STOPS } from '../src/data/sample'
import { kmBetween, nearest, parkingRisk } from '../src/lib/geo'
import type { Cargo, Depot, RainCell, Stop } from '../src/lib/types'

export const DEPARTURE = 9 * 60 // 09:00, as in the sample run
/** Opening hours for a stop without a booked slot. */
export const OPEN = { start: 9 * 60, end: 18 * 60 }
export const TYPES = ['easy', 'tight', 'rain', 'mixed', 'combined'] as const
export type ScenarioType = (typeof TYPES)[number]
export const SIZES = [5, 10, 15] as const
export const SEEDS = [1, 2, 3, 4] as const

export interface PoolPoint {
  id: string
  name: string
  address: string
  lng: number
  lat: number
  area: string
  /** the carpark used when unloading, from the sample data or the HDB list */
  park: { name: string; lng: number; lat: number }
}

export interface Scenario {
  id: string
  type: ScenarioType
  size: number
  seed: number
  depot: Depot
  stops: Stop[]
  rain: RainCell[]
}

/** mulberry32: small, fast, and identical on every machine. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
function shuffle<T>(r: () => number, items: T[]) {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const AREAS = (neaAreas.areas as [string, number, number][]).map(([name, lng, lat]) => ({ name, lng, lat }))
const areaOf = (p: { lng: number; lat: number }) => nearest(AREAS, p)?.item.name ?? 'Singapore'
/** Islands: no road from the depot. Areas with no HDB block nearby drop out at the 2 km check. */
const OFFSHORE = new Set(['Pulau Tekong', 'Pulau Ubin', 'Western Islands', 'Southern Islands', 'Sentosa'])

/**
 * The delivery points: the ten named stops of the sample run and address book,
 * plus, for every mainland NEA forecast area, the HDB block nearest the area's
 * label point (within 2 km) as a stand-in customer in that estate.
 */
export function buildPool(): PoolPoint[] {
  const named: PoolPoint[] = [...SAMPLE_STOPS, ...ADDRESS_BOOK].map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    lng: s.lng,
    lat: s.lat,
    area: s.area,
    park: { name: s.parking.name, lng: s.parking.lng, lat: s.parking.lat },
  }))
  const blocks = (hdb.carparks as [string, string, number, number][]).map(([no, address, lng, lat]) => ({ no, address, lng, lat }))
  const taken = new Set(named.map((p) => p.id))
  const extra: PoolPoint[] = []
  for (const a of AREAS) {
    if (OFFSHORE.has(a.name)) continue
    const near = nearest(blocks, a)
    if (!near || near.km > 2) continue
    const b = near.item
    if (taken.has(`H${b.no}`)) continue
    taken.add(`H${b.no}`)
    extra.push({
      id: `H${b.no}`,
      name: `Customer at ${b.address}`,
      address: b.address,
      lng: b.lng,
      lat: b.lat,
      area: areaOf(b),
      park: { name: `HDB carpark ${b.no}`, lng: b.lng, lat: b.lat },
    })
  }
  return [...named, ...extra]
}

type Matrix = { ids: string[]; minutes: number[][] }
/** Free-flow drive minutes between two pool ids, from the saved matrix. */
const minutesFrom = (m: Matrix) => {
  const at = new Map(m.ids.map((id, i) => [id, i]))
  return (a: string, b: string) => m.minutes[at.get(a)!][at.get(b)!]
}

/**
 * One scenario.
 * - easy: open 09:00–18:00, no rain, all chilled. The control: there is little
 *   to trade, so ColdRoute should stay close to the shortest route.
 * - tight: half the stops get a booked 30–60 min slot. Slots are placed on the
 *   arrival times of a random order, so a route with no late stop exists.
 * - rain: one heavy cell (two for 10+ stops) over stops' areas for 60–120 min,
 *   starting at a random time in the first half of the run.
 * - mixed: a third each of Pharma, Frozen and Chilled, all at least 8 km from
 *   the depot, so time on board matters.
 * - combined: tight + rain + mixed.
 */
export function makeScenario(pool: PoolPoint[], matrix: Matrix, type: ScenarioType, size: number, seed: number): Scenario {
  // the seed alone fixes the scenario; type and size only pick a stream
  const r = rng(seed * 1000 + TYPES.indexOf(type) * 100 + size)
  const drive = minutesFrom(matrix)
  const far = type === 'mixed' || type === 'combined'
  const candidates = pool.filter((p) => !far || kmBetween(DEPOT, p) >= 8)
  const picked = shuffle(r, candidates).slice(0, size)

  const cargo: Cargo[] =
    far ? shuffle(r, picked.map((_, i) => (['PHARMA', 'FROZEN', 'CHILLED'] as const)[i % 3])) : picked.map(() => 'CHILLED')
  const stops: Stop[] = picked.map((p, i) => {
    const distanceKm = Math.round(kmBetween(p, p.park) * 100) / 100 || int(r, 5, 30) / 100
    const freePct = int(r, 5, 80)
    return {
      id: p.id,
      name: p.name,
      short: p.name,
      address: p.address,
      lng: p.lng,
      lat: p.lat,
      windowStart: OPEN.start,
      windowEnd: OPEN.end,
      service: int(r, 6, 15),
      cargo: cargo[i],
      area: p.area,
      forecast: 'Fair',
      parking: { name: p.park.name, lng: p.park.lng, lat: p.park.lat, distanceKm, freePct, risk: parkingRisk(distanceKm, freePct) },
    }
  })

  // arrival times along a random order: used to place slots and rain fairly,
  // without favouring the shortest route or ColdRoute
  const order = shuffle(r, stops)
  const arrival: Record<string, number> = {}
  let t = DEPARTURE
  let prev = DEPOT.id
  for (const s of order) {
    t += drive(prev, s.id)
    arrival[s.id] = t
    t += s.service
    prev = s.id
  }
  const runLength = t - DEPARTURE
  // the random order meets every slot by construction; it must also finish by closing time
  if (Object.values(arrival).some((at) => at > OPEN.end)) throw new Error(`${type}-${size}-s${seed}: the random order arrives after ${OPEN.end / 60}:00`)

  if (type === 'tight' || type === 'combined') {
    for (const s of shuffle(r, stops).slice(0, Math.round(size / 2))) {
      const start = Math.floor((arrival[s.id] - int(r, 0, 15)) / 5) * 5
      s.windowStart = Math.max(OPEN.start, start)
      s.windowEnd = Math.ceil((start + int(r, 30, 60)) / 5) * 5
    }
  }

  const rain: RainCell[] = []
  if (type === 'rain' || type === 'combined') {
    const areas = shuffle(r, [...new Set(stops.map((s) => s.area))]).slice(0, size >= 10 ? 2 : 1)
    for (const area of areas) {
      const start = DEPARTURE + int(r, 15, Math.max(30, Math.round(runLength / 2)))
      const at = stops.find((s) => s.area === area)!
      rain.push({ area, label: 'Heavy rain', start, end: start + int(r, 60, 120), center: [at.lng, at.lat], radiusKm: 3, heavy: true })
    }
  }
  for (const s of stops) if (rain.some((c) => c.area === s.area)) s.forecast = 'Heavy rain'

  return { id: `${type}-${size}-s${seed}`, type, size, seed, depot: DEPOT, stops, rain }
}
