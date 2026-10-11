import { beforeEach, describe, expect, it, vi } from 'vitest'
import { optimise, simulate } from '../optimizer'
import type { Depot, RainCell, Stop, Weights } from '../types'

// Fixed road times isolate scoring from OSRM availability and geography.
const roads = vi.hoisted(() => ({ minutes: {} as Record<string, number> }))
vi.mock('../roads', () => ({
  travel: (a: { id: string }, b: { id: string }) => ({
    minutes: roads.minutes[`${a.id}>${b.id}`] ?? 5,
    km: 1,
    real: true,
  }),
  legGeometry: (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => [
    [a.lng, a.lat], [b.lng, b.lat],
  ],
}))

const depot: Depot = { id: 'D', name: 'Test depot', address: 'Singapore', lng: 103.8, lat: 1.3 }
const driveOnly: Weights = { drive: 1, late: 0, weather: 0, parking: 0, cold: 0 }
const allWeights: Weights = { drive: 1, late: 6, weather: 4, parking: 0.6, cold: 0.8 }
const stop = (id: string, changes: Partial<Stop> = {}): Stop => ({
  id, name: id, short: id, address: 'Test address', lng: 103.81, lat: 1.31,
  windowStart: 540, windowEnd: 1000, service: 10, cargo: 'CHILLED',
  area: 'City', forecast: 'Fair', trafficRisk: 0,
  parking: { name: 'Loading bay', lng: 103.81, lat: 1.31, distanceKm: 0, freePct: 100, risk: 0 },
  ...changes,
})
const rain = (start: number, end: number, area = 'City'): RainCell => ({
  area, label: 'Test rain', start, end, center: [103.81, 1.31], radiusKm: 1, heavy: true,
})
const context = (list: Stop[], weights = allWeights, cells: RainCell[] = []) => ({
  depot, stops: Object.fromEntries(list.map(s => [s.id, s])), departure: 540, weights, rain: cells,
})

beforeEach(() => { roads.minutes = {} })

describe('simulate: fixed scoring scenarios', () => {
  it('waits for a delivery window and includes service time in the next arrival', () => {
    const plan = simulate(['A', 'B'], context([stop('A', { windowStart: 600 }), stop('B')]))
    expect(plan.byId.A).toMatchObject({ arrival: 545, start: 600, wait: 55, finish: 610, late: 0 })
    expect(plan.byId.B.arrival).toBe(615)
    expect(plan.end).toBe(625)
  })

  it('counts late deliveries and their weighted lateness cost', () => {
    const plan = simulate(['A'], context([stop('A', { windowEnd: 542 })]))
    expect(plan.lateStops).toBe(1)
    expect(plan.lateMinutes).toBe(3)
    expect(plan.byId.A.cost.lateness).toBe(18)
  })

  it.each([
    ['rain begins exactly when unloading finishes', 555, 565, 'City', false],
    ['rain ends exactly when unloading starts', 535, 545, 'City', false],
    ['rain overlaps unloading', 548, 552, 'City', true],
    ['rain affects a different forecast area', 540, 560, 'Woodlands', false],
  ])('%s', (_label, start, end, area, expected) => {
    const plan = simulate(['A'], context([stop('A')], allWeights, [rain(start, end, area)]))
    expect(plan.byId.A.inRain).toBe(expected)
    expect(plan.rainStops).toBe(expected ? 1 : 0)
    expect(plan.byId.A.cost.weather).toBe(expected ? 40 : 0)
  })

  it('raises the modelled exposure and parking cost during a parking crunch', () => {
    const clear = stop('A')
    const crowded = stop('A', { parking: { ...clear.parking, risk: 1, freePct: 0 } })
    const dry = simulate(['A'], context([clear]))
    const crunch = simulate(['A'], context([crowded]))
    const wetCrunch = simulate(['A'], context([crowded], allWeights, [rain(540, 560)]))
    expect(crunch.byId.A.cost.parking).toBe(6)
    expect(crunch.exposure).toBe(25)
    expect(crunch.cost).toBeGreaterThan(dry.cost)
    expect(wetCrunch.exposure).toBe(35)
    expect(wetCrunch.byId.A.cost.weather).toBe(80)
    // Exposure is a risk model, not measured temperature or added service time.
    expect(wetCrunch.end).toBe(crunch.end)
  })

  it('reports a total cost equal to all weighted row contributions', () => {
    const plan = simulate(['A', 'B'], context([stop('A', { windowEnd: 542 }), stop('B')], allWeights, [rain(540, 560)]))
    const total = plan.rows.reduce((sum, row) => sum + Object.values(row.cost).reduce((a, b) => a + b, 0), 0)
    expect(plan.cost).toBeCloseTo(total, 10)
    expect(plan.byId.A).toEqual(plan.rows[0])
    expect(plan.rows.map(row => row.seq)).toEqual([1, 2])
  })
})

describe('optimise: route decisions and invariants', () => {
  it('returns an empty plan safely when there are no stops', () => {
    const result = optimise(depot, [], 540, allWeights, [])
    expect(result.recommended).toMatchObject({ order: [], rows: [], drive: 0, cost: 0, end: 540 })
    expect(result.highestRiskId).toBe('')
    expect(result.evaluated).toBe(1)
  })

  it('handles one stop without losing it or adding a return leg', () => {
    const result = optimise(depot, [stop('A')], 540, allWeights, [])
    expect(result.recommended.order).toEqual(['A'])
    expect(result.recommended.drive).toBe(5)
    expect(result.highestRiskId).toBe('A')
  })

  it.each([[3, 6], [8, 40320]])('checks all permutations for %i stops', (size, permutations) => {
    const list = Array.from({ length: size }, (_, i) => stop(`S${i}`))
    expect(optimise(depot, list, 540, driveOnly, []).evaluated).toBe(permutations)
  })

  it('keeps the shortest-drive baseline separate from a tight pharma deadline', () => {
    roads.minutes = { 'D>A': 2, 'D>B': 4, 'A>B': 8, 'B>A': 8 }
    const list = [stop('A'), stop('B', { cargo: 'PHARMA', windowEnd: 550 })]
    const result = optimise(depot, list, 540, { ...driveOnly, late: 10 }, [])
    expect(result.baseline.order).toEqual(['A', 'B'])
    expect(result.baseline.drive).toBe(10)
    expect(result.baseline.lateStops).toBe(1)
    expect(result.recommended.order).toEqual(['B', 'A'])
    expect(result.recommended.drive).toBe(12)
    expect(result.recommended.lateStops).toBe(0)
    expect(result.recommended.cost).toBeLessThan(result.baseline.cost)
  })

  it('moves a rainy-area delivery later when weather is the only extra penalty', () => {
    const list = [stop('A'), stop('B', { area: 'Woodlands' })]
    const result = optimise(depot, list, 540, { ...driveOnly, weather: 10 }, [rain(540, 555)])
    expect(result.baseline.order).toEqual(['A', 'B'])
    expect(result.baseline.rainStops).toBe(1)
    expect(result.recommended.order).toEqual(['B', 'A'])
    expect(result.recommended.rainStops).toBe(0)
  })

  it('prioritises more sensitive cargo when drive times and windows are equal', () => {
    const list = [stop('A', { cargo: 'CHILLED' }), stop('B', { cargo: 'PHARMA' })]
    const result = optimise(depot, list, 540, { ...driveOnly, cold: 10 }, [])
    expect(result.baseline.order).toEqual(['A', 'B'])
    expect(result.recommended.order).toEqual(['B', 'A'])
    expect(result.recommended.cost).toBeLessThan(result.baseline.cost)
  })

  it('does not mutate the input stops, rain or weights', () => {
    const list = [stop('A'), stop('B')]
    const cells = [rain(540, 560)]
    const before = structuredClone({ list, cells, weights: allWeights, depot })
    optimise(depot, list, 540, allWeights, cells)
    expect({ list, cells, weights: allWeights, depot }).toEqual(before)
  })

  it.each([10, 15])('preserves every stop and a non-worse score during %i-stop local search', size => {
    const list = Array.from({ length: size }, (_, i) => stop(`S${i}`, {
      windowEnd: 560 + i * 15, cargo: i % 2 ? 'PHARMA' : 'CHILLED',
    })).reverse()
    const input = simulate(list.map(s => s.id), context(list))
    const result = optimise(depot, list, 540, allWeights, [])
    for (const plan of [result.baseline, result.recommended]) {
      expect([...plan.order].sort()).toEqual(list.map(s => s.id).sort())
      expect(new Set(plan.order).size).toBe(size)
      expect(plan.rows).toHaveLength(size)
      expect(Number.isFinite(plan.cost)).toBe(true)
      expect(Number.isFinite(plan.end)).toBe(true)
    }
    expect(result.baseline.drive).toBeLessThanOrEqual(input.drive)
    expect(result.recommended.cost).toBeLessThanOrEqual(result.baseline.cost + 1e-6)
    expect(result.evaluated).toBeGreaterThan(0)
    // This checks the heuristic path, not a global optimum or a timing SLA.
    expect(result.evaluated).toBeLessThan(3628800)
  })
})
