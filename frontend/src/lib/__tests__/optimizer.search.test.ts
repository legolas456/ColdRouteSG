import { describe, expect, it } from 'vitest'
import { DEPARTURE, DEPOT, RAIN_CELLS } from '../../data/sample'
import { parkingRisk } from '../geo'
import { optimise, simulate } from '../optimizer'
import { PROFILES } from '../profiles'
import type { Cargo, Stop, Weights } from '../types'

// Seeded random runs. Their stop ids are not in the bundled OSRM snapshot, so drive
// times come from the deterministic road-factor estimate in roads.ts, never the network.
const AREAS = ['City', 'Choa Chu Kang', 'Bedok', 'Tampines', 'Jurong West', 'Bishan']
const CARGOS: Cargo[] = ['PHARMA', 'FROZEN', 'CHILLED']

function randomRun(seed: number, n: number): Stop[] {
  let s = seed
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from({ length: n }, (_, i) => {
    const lat = 1.29 + rand() * 0.14
    const lng = 103.7 + rand() * 0.26
    const distanceKm = 0.05 + rand() * 0.75
    const freePct = 5 + rand() * 75
    const windowStart = 540 + Math.floor(rand() * 8) * 15
    return {
      id: `S${i + 1}`, name: `Stop ${i + 1}`, short: `S${i + 1}`, address: 'Test address', lng, lat,
      windowStart, windowEnd: windowStart + 60 + Math.floor(rand() * 13) * 15,
      service: 5 + Math.floor(rand() * 16), cargo: CARGOS[Math.floor(rand() * 3)],
      area: AREAS[Math.floor(rand() * AREAS.length)], forecast: 'Test',
      parking: { name: 'Test bay', lng, lat, distanceKm, freePct, risk: parkingRisk(distanceKm, freePct) },
    }
  })
}

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

function exhaustiveBest(stops: Stop[], weights: Weights) {
  const ctx = { depot: DEPOT, stops: Object.fromEntries(stops.map((s) => [s.id, s])), departure: DEPARTURE, weights, rain: RAIN_CELLS }
  let cost = Infinity
  let drive = Infinity
  for (const order of permutations(stops.map((s) => s.id))) {
    const plan = simulate(order, ctx)
    cost = Math.min(cost, plan.cost)
    drive = Math.min(drive, plan.drive)
  }
  return { cost, drive }
}

describe('optimise: local search above eight stops', () => {
  // The earlier 2-opt-only search missed the optimum on each of these runs: a
  // costlier ColdRoute plan on seeds 4, 6 and 9, and a longer shortest route on
  // seeds 4, 8 and 9. The shortest route is now exact; the ColdRoute plan comes
  // from a local search, which is not guaranteed optimal on every run.
  it.each([4, 6, 8, 9])('matches exhaustive search on 9-stop run %i', (seed) => {
    const stops = randomRun(seed, 9)
    const weights = PROFILES.balanced.weights
    const best = exhaustiveBest(stops, weights)
    const result = optimise(DEPOT, stops, DEPARTURE, weights, RAIN_CELLS)
    expect(result.recommended.cost).toBeCloseTo(best.cost, 9)
    expect(result.baseline.drive).toBeCloseTo(best.drive, 9)
    // Still a local search: far fewer orders than even the 8-stop enumeration.
    expect(result.evaluated).toBeLessThan(40320)
  }, 60_000)

  it('gives the same plan every time for the same run', () => {
    const stops = randomRun(6, 12)
    const weights = PROFILES.pharma.weights
    const first = optimise(DEPOT, stops, DEPARTURE, weights, RAIN_CELLS)
    const second = optimise(DEPOT, stops, DEPARTURE, weights, RAIN_CELLS)
    expect(second.recommended.order).toEqual(first.recommended.order)
    expect(second.baseline.order).toEqual(first.baseline.order)
  })
})
