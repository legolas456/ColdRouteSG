// Drive times and road geometry.
//
// The sample run ships with a snapshot from the public OSRM server
// (src/data/osrm.json), so the demo never waits on the network. Any other stop
// (added through the OneMap search) gets its times from the OSRM table service
// before optimising, and the legs of the chosen plans are fetched afterwards.
// Until then, or if OSRM is down, times are a road-factor estimate and legs are
// straight lines. The cloud planner (planner/) fills the same tables from
// Amazon Location Service instead, so this module stays free of React.
import snapshot from '../data/osrm.json'

export type Point = { id: string; lng: number; lat: number }

const OSRM = 'https://router.project-osrm.org'
const TIMEOUT_MS = 12_000

const base = snapshot as unknown as {
  minutes: Record<string, Record<string, number>>
  km: Record<string, Record<string, number>>
  legs: Record<string, [number, number][]>
}
// mutable copies: runtime results are merged in
const minutes: Record<string, Record<string, number>> = Object.fromEntries(Object.entries(base.minutes).map(([k, v]) => [k, { ...v }]))
const km: Record<string, Record<string, number>> = Object.fromEntries(Object.entries(base.km).map(([k, v]) => [k, { ...v }]))
const legs: Record<string, [number, number][]> = { ...base.legs }

// a stop id is only valid for the coordinates it was measured at
const measuredAt: Record<string, string> = {}
const where = (p: Point) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`

let version = 0
const listeners = new Set<() => void>()
const bump = () => {
  version++
  listeners.forEach((l) => l())
}
/** Tell `listener` when new road data arrives (lib/hooks.ts useRoadsVersion redraws legs on it). */
export const subscribeRoads = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const roadsVersion = () => version

export const haversineKm = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

const known = (a: Point, b: Point) => minutes[a.id]?.[b.id] !== undefined && km[a.id]?.[b.id] !== undefined

/** Real OSRM values when we have them, a road-factor estimate otherwise. */
export function travel(a: Point, b: Point) {
  if (known(a, b)) return { minutes: minutes[a.id][b.id], km: km[a.id][b.id], real: true }
  const crow = haversineKm(a, b)
  return { km: crow * 1.35, minutes: ((crow * 1.35) / 38) * 60 + 4, real: false }
}

export function legGeometry(a: Point, b: Point): [number, number][] {
  return (
    legs[`${a.id}>${b.id}`] ?? [
      [a.lng, a.lat],
      [b.lng, b.lat],
    ]
  )
}

/** True when every pair in the run has a real OSRM time. */
export const allReal = (points: Point[]) => points.every((a) => points.every((b) => a.id === b.id || known(a, b)))

async function getJson(url: string) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`OSRM answered ${res.status}`)
    const body = await res.json()
    if (body.code !== 'Ok') throw new Error(`OSRM: ${body.message ?? body.code}`)
    return body
  } finally {
    clearTimeout(timer)
  }
}

/** Forget values measured for an id at other coordinates (an id reused for a new place). */
function invalidate(points: Point[]) {
  for (const p of points) {
    const w = where(p)
    if (measuredAt[p.id] && measuredAt[p.id] !== w) {
      delete minutes[p.id]
      delete km[p.id]
      for (const row of [...Object.values(minutes), ...Object.values(km)]) delete row[p.id]
      for (const k of Object.keys(legs)) if (k.startsWith(`${p.id}>`) || k.endsWith(`>${p.id}`)) delete legs[k]
    }
    measuredAt[p.id] ??= w
  }
}

/**
 * Makes sure every pair of points has a real drive time: one OSRM table call
 * for the whole run (the demo server takes up to 100 points). Resolves to
 * false if OSRM could not be reached; travel() then keeps estimating.
 */
export async function ensureMatrix(points: Point[]): Promise<boolean> {
  invalidate(points)
  if (allReal(points)) return true
  try {
    const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
    const t = await getJson(`${OSRM}/table/v1/driving/${coords}?annotations=duration,distance`)
    points.forEach((a, i) => {
      minutes[a.id] ??= {}
      km[a.id] ??= {}
      points.forEach((b, j) => {
        const d = t.durations?.[i]?.[j]
        const m = t.distances?.[i]?.[j]
        if (d == null || m == null) return
        minutes[a.id][b.id] = Math.round((d / 60) * 10) / 10
        km[a.id][b.id] = Math.round((m / 1000) * 10) / 10
      })
      measuredAt[a.id] = where(a)
    })
    bump()
    return allReal(points)
  } catch {
    return false
  }
}

export const round5 = (n: number) => Math.round(n * 1e5) / 1e5

/** Ramer–Douglas–Peucker, as in scripts/fetch-osrm.mjs, to keep legs light. */
export function simplify(points: [number, number][], tolerance: number) {
  if (points.length < 3) return points
  const sqTol = tolerance * tolerance
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let maxSq = 0
    let index = -1
    const [x1, y1] = points[first]
    const [x2, y2] = points[last]
    for (let i = first + 1; i < last; i++) {
      const [x, y] = points[i]
      let dx = x2 - x1
      let dy = y2 - y1
      let t = dx || dy ? ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy) : 0
      t = Math.max(0, Math.min(1, t))
      dx = x - (x1 + t * dx)
      dy = y - (y1 + t * dy)
      const sq = dx * dx + dy * dy
      if (sq > maxSq) {
        maxSq = sq
        index = i
      }
    }
    if (maxSq > sqTol && index > 0) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

/**
 * Fetches road geometry for every leg of these paths that we do not have yet:
 * one OSRM route call per path, split into legs from its steps.
 */
export async function ensureLegs(paths: Point[][]): Promise<boolean> {
  let ok = true
  for (const path of paths) {
    const missing = path.slice(1).some((p, i) => !legs[`${path[i].id}>${p.id}`])
    if (!missing || path.length < 2) continue
    try {
      const coords = path.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
      const r = await getJson(`${OSRM}/route/v1/driving/${coords}?overview=false&steps=true&geometries=geojson`)
      const routeLegs = r.routes?.[0]?.legs ?? []
      routeLegs.forEach((leg: { steps: Array<{ geometry: { coordinates: [number, number][] } }> }, i: number) => {
        const line: [number, number][] = []
        for (const step of leg.steps) {
          for (const c of step.geometry.coordinates) {
            const last = line[line.length - 1]
            if (!last || last[0] !== c[0] || last[1] !== c[1]) line.push(c)
          }
        }
        if (line.length > 1 && path[i + 1]) {
          legs[`${path[i].id}>${path[i + 1].id}`] = simplify(line, 0.00012).map(([x, y]) => [round5(x), round5(y)])
        }
      })
    } catch {
      ok = false
    }
  }
  bump()
  return ok
}

/** Drive times measured elsewhere (the cloud planner's Location Service matrix), used like OSRM's. */
export function setDriveTimes(points: Point[], times: { from: string; to: string; minutes: number; km: number }[]) {
  invalidate(points)
  for (const t of times) {
    minutes[t.from] ??= {}
    km[t.from] ??= {}
    minutes[t.from][t.to] = Math.round(t.minutes * 10) / 10
    km[t.from][t.to] = Math.round(t.km * 10) / 10
  }
  for (const p of points) measuredAt[p.id] = where(p)
  bump()
}

/** Road geometry measured elsewhere, keyed "fromId>toId". */
export function mergeLegs(lines: Record<string, [number, number][]>) {
  Object.assign(legs, lines)
  bump()
}

/** The road geometry known for each leg of a path, keyed "fromId>toId". */
export function legsOf(path: Point[]): Record<string, [number, number][]> {
  const out: Record<string, [number, number][]> = {}
  path.slice(1).forEach((p, i) => {
    const key = `${path[i].id}>${p.id}`
    if (legs[key]) out[key] = legs[key]
  })
  return out
}
