import { describe, expect, it } from 'vitest'
// The grid backend/tests/test_traffic.py builds from its LTA fixture; both sides
// read this one file, so the Python builder and this parser cannot drift apart.
import BACKEND_GRID from '../../../../backend/tests/fixtures/traffic_grid_expected.json'
import { areaFactor, legFactor, MAX_FACTOR, parseTrafficGrid, slowStretches, type TrafficGrid } from '../traffic'

const ORIGIN: [number, number] = [103.55, 1.15]
const CELL = 0.01
const cellOf = (lng: number, lat: number) => [Math.floor((lng - ORIGIN[0]) / CELL), Math.floor((lat - ORIGIN[1]) / CELL)]

/** A grid from [lng, lat, factor, km] entries, one per cell. */
function grid(cells: [number, number, number, number][], fetchedAt = '2026-10-27T08:30:00+08:00'): TrafficGrid {
  return parseTrafficGrid({
    fetchedAt,
    origin: ORIGIN,
    cellDeg: CELL,
    stretches: cells.length,
    slowShare: 0,
    cells: cells.map(([lng, lat, factor, km]) => [...cellOf(lng, lat), factor, km]),
  })
}

/** Cell centres over Singapore (whole-number steps, so no rounding drift), with plenty of road in each. */
function cover(factorAt: (lng: number, lat: number) => number) {
  const cells: [number, number, number, number][] = []
  for (let i = 5; i < 50; i++) {
    for (let j = 5; j < 33; j++) {
      const lng = ORIGIN[0] + (i + 0.5) * CELL
      const lat = ORIGIN[1] + (j + 0.5) * CELL
      cells.push([lng, lat, factorAt(lng, lat), 5])
    }
  }
  return grid(cells)
}
const uniform = (factor: number) => cover(() => factor)

describe('parseTrafficGrid', () => {
  it('reads the grid the backend builds from LTA records', () => {
    const g = parseTrafficGrid(BACKEND_GRID)
    expect(g.cells.size).toBe(BACKEND_GRID.cells.length)
    expect(g.stretches).toBe(BACKEND_GRID.stretches)
    expect(g.slowShare).toBe(BACKEND_GRID.slowShare)
    expect(g.origin).toEqual(ORIGIN)
    // 08:30 in Singapore
    expect(g.at).toBe(8 * 60 + 30)
    // Orchard Road's cell: one jammed and one clear stretch, weighted by length
    expect(g.cells.get('28,15')).toEqual({ factor: 2.06, km: 0.55 })
  })

  it('agrees with the backend on which cell a point falls in', () => {
    // the Serangoon Road stretch from LTA's guide, midpoint in cell 31,17 on the Python side
    const mid = { lng: (103.86246461405193 + 103.86315591911669) / 2, lat: (1.3220591510051254 + 1.3215993547809128) / 2 }
    expect(cellOf(mid.lng, mid.lat)).toEqual([31, 17])
    expect(parseTrafficGrid(BACKEND_GRID).cells.get('31,17')?.factor).toBe(3)
  })

  it('converts the reading time to Singapore minutes whatever the offset', () => {
    expect(parseTrafficGrid({ ...BACKEND_GRID, fetchedAt: '2026-10-27T00:30:00Z' }).at).toBe(8 * 60 + 30)
    expect(parseTrafficGrid({ ...BACKEND_GRID, fetchedAt: '2026-10-27T16:10:00Z' }).at).toBe(10)
  })

  it.each([
    ['not an object', null],
    ['no cells', { ...BACKEND_GRID, cells: undefined }],
    ['a bad origin', { ...BACKEND_GRID, origin: [103.55] }],
    ['a zero cell size', { ...BACKEND_GRID, cellDeg: 0 }],
    ['a bad time', { ...BACKEND_GRID, fetchedAt: 'yesterday' }],
    ['a factor below 1', { ...BACKEND_GRID, cells: [[1, 2, 0.5, 1]] }],
    ['a cell without road', { ...BACKEND_GRID, cells: [[1, 2, 1.5, 0]] }],
    ['a fractional cell index', { ...BACKEND_GRID, cells: [[1.5, 2, 1.5, 1]] }],
  ])('rejects a grid with %s', (_label, raw) => {
    expect(() => parseTrafficGrid(raw)).toThrow('Unexpected road-speed grid')
  })

  it('caps factors at MAX_FACTOR', () => {
    expect(parseTrafficGrid({ ...BACKEND_GRID, cells: [[1, 2, 9, 1]] }).cells.get('1,2')?.factor).toBe(MAX_FACTOR)
  })
})

describe('areaFactor', () => {
  const p = { lng: 103.855, lat: 1.305 }

  it('is 1 where LTA monitors no roads', () => {
    expect(areaFactor(grid([]), p)).toBe(1)
  })

  it('weights the 3 × 3 cells around a point by their road km', () => {
    // two neighbouring cells: 2 km at factor 2 and 2 km at factor 1
    const g = grid([
      [103.855, 1.305, 2, 2],
      [103.865, 1.305, 1, 2],
    ])
    expect(areaFactor(g, p)).toBeCloseTo(1.5, 12)
  })

  it('ignores cells two away', () => {
    expect(areaFactor(grid([[103.875, 1.305, 3, 5]]), p)).toBe(1)
  })

  it('scales the slowdown down where little road is monitored', () => {
    // 0.25 km of road at factor 3: only a quarter of the slowdown counts
    expect(areaFactor(grid([[103.855, 1.305, 3, 0.25]]), p)).toBeCloseTo(1.5, 12)
    expect(areaFactor(grid([[103.855, 1.305, 3, 1]]), p)).toBeCloseTo(3, 12)
  })
})

describe('legFactor', () => {
  const west = { lng: 103.7, lat: 1.33 }
  const east = { lng: 103.95, lat: 1.33 }

  it('is the uniform factor when every cell has it', () => {
    expect(legFactor(west, east, uniform(2))).toBeCloseTo(2, 12)
    expect(legFactor(west, east, uniform(1))).toBe(1)
  })

  it('is 1 without data; a leg that does not move takes the factor at its point', () => {
    expect(legFactor(west, east, grid([]))).toBe(1)
    expect(legFactor(west, west, uniform(2))).toBeCloseTo(2, 12)
  })

  it('averages along the leg: slow on the eastern half only', () => {
    const g = cover((lng) => (lng > 103.825 ? 3 : 1))
    const f = legFactor(west, east, g)
    // half the samples at 3, half at 1, a little blur at the boundary
    expect(f).toBeGreaterThan(1.9)
    expect(f).toBeLessThan(2.1)
    // the same leg backwards takes as long
    expect(legFactor(east, west, g)).toBeCloseTo(f, 12)
  })

  it('never exceeds MAX_FACTOR', () => {
    expect(legFactor(west, east, uniform(MAX_FACTOR))).toBeCloseTo(MAX_FACTOR, 12)
  })
})

describe('slowStretches', () => {
  const road: [number, number][] = [
    [103.80, 1.30],
    [103.90, 1.30],
  ]
  // a jam in the two cells from 103.84 to 103.86, on the road's row of cells
  const slowMiddle = () => cover((lng) => (lng > 103.84 && lng < 103.86 ? 3 : 1))

  it('finds the slow run between two road vertices', () => {
    const out = slowStretches(road, slowMiddle())
    expect(out).toHaveLength(1)
    const [s] = out
    // inside the jam, with blur from the neighbouring cells
    expect(s.coords[0][0]).toBeGreaterThan(103.82)
    expect(s.coords.at(-1)![0]).toBeLessThan(103.88)
    expect(s.km).toBeGreaterThan(0.3)
    expect(s.mid[0]).toBeGreaterThan(s.coords[0][0])
  })

  it('finds nothing on free-flowing roads or without data', () => {
    expect(slowStretches(road, uniform(1))).toEqual([])
    expect(slowStretches(road, grid([]))).toEqual([])
  })

  it('skips runs shorter than the minimum', () => {
    expect(slowStretches(road, slowMiddle(), 50)).toEqual([])
  })
})
