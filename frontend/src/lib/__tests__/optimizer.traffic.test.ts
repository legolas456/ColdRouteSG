import { beforeEach, describe, expect, it, vi } from 'vitest'
import { optimise, simulate, trafficFactor } from '../optimizer'
import { PROFILES } from '../profiles'
import { legFactor, parseTrafficGrid, type TrafficGrid } from '../traffic'
import type { Depot, Stop, Weights } from '../types'

// Drive times either fixed per leg or from straight-line distance, so the
// expected values do not depend on OSRM.
const roads = vi.hoisted(() => ({ mode: 'distance' as 'distance' | 'fixed', minutes: 10 }))
vi.mock('../roads', () => ({
  travel: (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
    if (roads.mode === 'fixed') return { minutes: roads.minutes, km: 5, real: true }
    const km = Math.hypot((b.lng - a.lng) * 111.3, (b.lat - a.lat) * 110.6) * 1.35
    return { minutes: (km / 38) * 60 + 4, km, real: true }
  },
  legGeometry: (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => [
    [a.lng, a.lat],
    [b.lng, b.lat],
  ],
}))

beforeEach(() => {
  roads.mode = 'distance'
})

const ORIGIN: [number, number] = [103.55, 1.15]
const CELL = 0.01
/** Cells over Singapore with a factor that depends on where they are. */
function cover(factorAt: (lng: number, lat: number) => number, fetchedAt = '2026-10-27T08:30:00+08:00'): TrafficGrid {
  const cells: number[][] = []
  for (let i = 5; i < 50; i++) {
    for (let j = 5; j < 33; j++) cells.push([i, j, factorAt(ORIGIN[0] + (i + 0.5) * CELL, ORIGIN[1] + (j + 0.5) * CELL), 5])
  }
  return parseTrafficGrid({ fetchedAt, origin: ORIGIN, cellDeg: CELL, stretches: cells.length, slowShare: 0, cells })
}

const depot: Depot = { id: 'D', name: 'Depot', address: 'Test', lng: 103.8, lat: 1.3 }
const stop = (id: string, lng: number, lat: number, changes: Partial<Stop> = {}): Stop => ({
  id, name: id, short: id, address: 'Test', lng, lat,
  windowStart: 540, windowEnd: 1200, service: 10, cargo: 'CHILLED', area: 'Test', forecast: 'Fair',
  parking: { name: 'Bay', lng, lat, distanceKm: 0, freePct: 100, risk: 0 },
  ...changes,
})
const driveOnly: Weights = { drive: 1, late: 0, weather: 0, parking: 0, cold: 0 }
const balanced = PROFILES.balanced.weights
const run = [
  stop('A', 103.86, 1.31, { cargo: 'PHARMA', windowEnd: 630 }),
  stop('B', 103.74, 1.33),
  stop('C', 103.83, 1.36, { cargo: 'FROZEN' }),
  stop('E', 103.9, 1.35),
  stop('F', 103.78, 1.29, { windowEnd: 660 }),
]

describe('optimise with live road speeds', () => {
  it('plans exactly as before without a reading', () => {
    const before = optimise(depot, run, 540, balanced, [])
    const after = optimise(depot, run, 540, balanced, [], null)
    expect(after.recommended.order).toEqual(before.recommended.order)
    expect(after.recommended.cost).toBe(before.recommended.cost)
    expect(after.trafficAt).toBeNull()
    for (const row of after.recommended.rows) {
      expect(row.trafficMinutes).toBe(0)
      expect(row.risk.T).toBe(0)
    }
  })

  it('stretches every leg by a uniform slowdown and records when the reading was', () => {
    const free = optimise(depot, run, 540, driveOnly, [])
    const slow = optimise(depot, run, 540, driveOnly, [], cover(() => 2))
    // the same order is still the shortest when every road is twice as slow
    expect(slow.baseline.order).toEqual(free.baseline.order)
    expect(slow.baseline.drive).toBeCloseTo(2 * free.baseline.drive, 9)
    slow.baseline.rows.forEach((row, i) => {
      const freeRow = free.baseline.rows[i]
      expect(row.legMinutes).toBeCloseTo(2 * freeRow.legMinutes, 9)
      expect(row.trafficMinutes).toBeCloseTo(freeRow.legMinutes, 9)
      expect(row.risk.T).toBeCloseTo(Math.min(1, freeRow.legMinutes / 15), 9)
      expect(row.legKm).toBe(freeRow.legKm)
    })
    expect(slow.trafficAt).toBe(8 * 60 + 30)
  })

  it('sends the fastest route west first when the roads east of the depot are jammed', () => {
    roads.mode = 'fixed'
    const east = stop('X', 103.86, 1.3)
    const west = stop('W', 103.74, 1.3)
    const free = optimise(depot, [east, west], 540, driveOnly, [])
    // equal drive times: the first order found wins
    expect(free.baseline.order).toEqual(['X', 'W'])
    const jam = cover((lng) => (lng > 103.82 ? 3 : 1))
    const slow = optimise(depot, [east, west], 540, driveOnly, [], jam)
    expect(slow.baseline.order).toEqual(['W', 'X'])
    const expected = 10 * legFactor(depot, west, jam) + 10 * legFactor(west, east, jam)
    expect(slow.baseline.drive).toBeCloseTo(expected, 9)
    expect(slow.baseline.byId.W.trafficMinutes).toBeCloseTo(10 * (legFactor(depot, west, jam) - 1), 9)
  })

  it('keeps the exact shortest route exact above eight stops', () => {
    const nine = Array.from({ length: 9 }, (_, k) => stop(`S${k}`, 103.65 + 0.035 * k, 1.28 + 0.02 * ((k * 5) % 7)))
    const jam = cover((lng, lat) => 1 + Math.abs(Math.sin(lng * 40) * Math.cos(lat * 55)) * 1.8)
    const result = optimise(depot, nine, 540, balanced, [], jam)
    const ctx = { depot, stops: Object.fromEntries(nine.map((s) => [s.id, s])), departure: 540, weights: driveOnly, rain: [], traffic: jam }
    let best = Infinity
    for (const order of permutations(nine.map((s) => s.id))) best = Math.min(best, simulate(order, ctx).drive)
    expect(result.baseline.drive).toBeCloseTo(best, 9)
    expect(result.recommended.cost).toBeLessThanOrEqual(result.baseline.cost + 1e-9)
    expect(result.recommended.drive).toBeCloseTo(
      result.recommended.rows.reduce((sum, row) => sum + row.legMinutes, 0),
      9,
    )
  }, 60_000)

  it('does not reuse a factor for a stop id moved to a new place', () => {
    const jam = cover((lng) => (lng > 103.82 ? 3 : 1))
    const here = stop('Q', 103.75, 1.3)
    const moved = stop('Q', 103.95, 1.3)
    expect(trafficFactor(depot, here, jam)).toBeCloseTo(legFactor(depot, here, jam), 12)
    expect(trafficFactor(depot, moved, jam)).toBeCloseTo(legFactor(depot, moved, jam), 12)
    expect(trafficFactor(depot, moved, jam)).toBeGreaterThan(trafficFactor(depot, here, jam))
    expect(trafficFactor(depot, here, null)).toBe(1)
  })
})

function* permutations(items: string[]): Generator<string[]> {
  const a = items.slice()
  const c = new Array(a.length).fill(0)
  yield a.slice()
  let i = 0
  while (i < a.length) {
    if (c[i] < i) {
      const j = i % 2 ? c[i] : 0
      ;[a[i], a[j]] = [a[j], a[i]]
      yield a.slice()
      c[i]++
      i = 0
    } else {
      c[i] = 0
      i++
    }
  }
}
