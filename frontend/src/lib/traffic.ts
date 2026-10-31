import { kmBetween } from './geo'

/**
 * Live road speeds: LTA DataMall Traffic Speed Bands, summarised by our backend
 * (backend/app/services/traffic.py) as delay factors on cells of about 1 km. A
 * factor is the roads' speed at night over their speed now: 1 when traffic
 * flows freely, 2 when the roads there take twice as long. LTA's AccountKey
 * stays on the server; the browser only reads the grid.
 */

type Point = { lng: number; lat: number }

export interface TrafficCell {
  factor: number
  /** monitored road in the cell, km */
  km: number
}

export interface TrafficGrid {
  /** when the backend read LTA, ISO time with the Singapore offset */
  fetchedAt: string
  /** when LTA measured the speeds (its lastUpdatedTime), or else when they were read: minutes after midnight in Singapore */
  at: number
  /** south-west corner of cell 0,0: [lng, lat] */
  origin: [number, number]
  cellDeg: number
  /** road stretches LTA reported */
  stretches: number
  /** share of monitored road km at SLOW_FACTOR or worse */
  slowShare: number
  /** keyed "i,j" */
  cells: Map<string, TrafficCell>
}

/**
 * Road counts as slow from 1.2 times its free-flow travel time: the map draws
 * the plan's road in rose there, and the backend's slowShare counts the same.
 * Against each road's own night speed, the area around a road (3 x 3 cells, as
 * the map looks) runs at most about 1.3 times slower at a weekday peak. On the
 * kept readings of 29-30 Oct 2026, 1.2 times marked 14% of the sample route at
 * the peaks, 2% at midday and none at night; 1.5 times marked nothing at all.
 */
export const SLOW_FACTOR = 1.2
export const MAX_FACTOR = 3
/** Spacing of the samples along a leg. */
const SAMPLE_KM = 0.5
/**
 * With less monitored road than this around a point, its slowdown is scaled
 * down in proportion, so one short jammed stretch in a quiet area cannot
 * triple a leg.
 */
const CONFIDENT_KM = 1

const minutesInSingapore = (iso: string) => {
  const d = new Date(iso)
  return ((d.getUTCHours() + 8) % 24) * 60 + d.getUTCMinutes()
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The grid JSON from /api/traffic/grid (or the published S3 copy). Throws if it is malformed. */
export function parseTrafficGrid(raw: unknown): TrafficGrid {
  const fail = (what: string) => new Error(`Unexpected road-speed grid (${what})`)
  if (!raw || typeof raw !== 'object') throw fail('not an object')
  const g = raw as Record<string, unknown>
  const { origin, cellDeg, cells, fetchedAt, measuredAt } = g
  if (!Array.isArray(origin) || origin.length !== 2 || !isNum(origin[0]) || !isNum(origin[1])) throw fail('origin')
  if (!isNum(cellDeg) || cellDeg <= 0) throw fail('cellDeg')
  if (typeof fetchedAt !== 'string' || Number.isNaN(Date.parse(fetchedAt))) throw fail('fetchedAt')
  if (!Array.isArray(cells)) throw fail('cells')
  const map = new Map<string, TrafficCell>()
  for (const c of cells) {
    if (!Array.isArray(c)) throw fail('cell')
    const [i, j, factor, km] = c as unknown[]
    if (!Number.isInteger(i) || !Number.isInteger(j) || !isNum(factor) || factor < 1 || !isNum(km) || km <= 0) throw fail('cell values')
    map.set(`${i},${j}`, { factor: Math.min(MAX_FACTOR, factor), km })
  }
  const measured = typeof measuredAt === 'string' && !Number.isNaN(Date.parse(measuredAt)) ? measuredAt : fetchedAt
  return {
    fetchedAt,
    at: minutesInSingapore(measured),
    origin: [origin[0], origin[1]],
    cellDeg,
    stretches: isNum(g.stretches) ? g.stretches : 0,
    slowShare: isNum(g.slowShare) ? g.slowShare : 0,
    cells: map,
  }
}

/** Road-km-weighted factor of the 3 × 3 cells around a point; 1 where LTA monitors no roads. */
export function areaFactor(grid: TrafficGrid, p: Point) {
  const i = Math.floor((p.lng - grid.origin[0]) / grid.cellDeg)
  const j = Math.floor((p.lat - grid.origin[1]) / grid.cellDeg)
  let weighted = 0
  let km = 0
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const cell = grid.cells.get(`${i + di},${j + dj}`)
      if (cell) {
        weighted += cell.factor * cell.km
        km += cell.km
      }
    }
  }
  if (!km) return 1
  return 1 + (weighted / km - 1) * Math.min(1, km / CONFIDENT_KM)
}

/**
 * How many times longer than OSRM's free-flow time a leg takes now: the mean
 * factor at points every 0.5 km along the straight line between its ends.
 * Each piece of road takes its free-flow time times its factor, so the
 * distance-weighted mean factor scales the whole leg. The straight line stands
 * in for the road path, which is only fetched for the two chosen plans.
 */
export function legFactor(a: Point, b: Point, grid: TrafficGrid) {
  const n = Math.max(1, Math.ceil(kmBetween(a, b) / SAMPLE_KM))
  let sum = 0
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n
    sum += areaFactor(grid, { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t })
  }
  return Math.min(MAX_FACTOR, sum / n)
}

const pairKm = (a: [number, number], b: [number, number]) => kmBetween({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] })

/** Points every ~0.2 km along a path, so a short slow stretch between two road vertices still shows. */
function densify(path: [number, number][], stepKm = 0.2) {
  const out: [number, number][] = path.slice(0, 1)
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]]
    const n = Math.ceil(pairKm(a, b) / stepKm)
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}

/** The slow runs along a road path, for the map: each with its length and a midpoint for a tag. */
export function slowStretches(path: [number, number][], grid: TrafficGrid, minKm = 0.3) {
  const out: Array<{ coords: [number, number][]; mid: [number, number]; km: number }> = []
  let run: [number, number][] = []
  const flush = () => {
    let km = 0
    for (let i = 1; i < run.length; i++) km += pairKm(run[i - 1], run[i])
    if (run.length > 1 && km >= minKm) out.push({ coords: run, mid: run[Math.floor(run.length / 2)], km })
    run = []
  }
  for (const p of densify(path)) {
    if (areaFactor(grid, { lng: p[0], lat: p[1] }) >= SLOW_FACTOR) run.push(p)
    else flush()
  }
  flush()
  return out
}
