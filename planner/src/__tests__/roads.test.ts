import { afterEach, describe, expect, it, vi } from 'vitest'
import { legsOf, travel } from '../../../frontend/src/lib/roads'
import { ensureDriveTimes, ensureRoadLines, toMeasure } from '../roads'
import { fakeMinutes, fakeRoads } from './fakes'

// ids of their own per test: the drive-time tables are shared, as in a warm Lambda
let n = 0
const run = (count: number) => {
  n++
  return Array.from({ length: count }, (_, i) => ({ id: `t${n}-${i}`, lng: 103.75 + i * 0.03, lat: 1.3 + (i % 2) * 0.02 }))
}

afterEach(() => vi.restoreAllMocks())

describe('drive times from Location Service', () => {
  it('measures every pair once, keeps them, and reads them back next time', async () => {
    const points = run(4)
    const roads = fakeRoads()
    // three rows, and the fourth point's column: 15 cells billed, a stop to itself among them
    expect(await ensureDriveTimes(points, roads.clients, 0)).toEqual({ source: 'location', cached: 0, measured: 12, billed: 15 })
    expect(roads.cache.size).toBe(12)
    const t = travel(points[0], points[3])
    expect(t.real).toBe(true)
    expect(t.minutes).toBeCloseTo(fakeMinutes([points[0].lng, points[0].lat], [points[3].lng, points[3].lat]), 1)
    // the same stops again (a reload, another container): all from the cache, none billed
    const again = fakeRoads(roads.cache)
    const moved = points.map((p) => ({ ...p, id: `${p.id}-b` }))
    expect(await ensureDriveTimes(moved, again.clients, 0)).toEqual({ source: 'location', cached: 12, measured: 0, billed: 0 })
    expect(again.matrixCalls).toEqual([])
    // each way as measured
    expect(travel(moved[3], moved[0]).minutes).toBeCloseTo(t.minutes - 3, 1)
  })

  it('adds one stop with its row and column only', async () => {
    const points = run(4)
    const roads = fakeRoads()
    await ensureDriveTimes(points.slice(0, 3), roads.clients, 0)
    roads.matrixCalls.length = 0
    expect(await ensureDriveTimes(points, roads.clients, 0)).toEqual({ source: 'location', cached: 6, measured: 6, billed: 7 })
    // the new stop to all, then the others to it
    expect(roads.matrixCalls.map((c) => [c.origins.length, c.destinations.length])).toEqual([
      [1, 4],
      [3, 1],
    ])
  })

  it('counts the pairs Location Service has no route for, and estimates them', async () => {
    const points = run(3)
    const [a, b] = points
    const roads = fakeRoads(undefined, false, (o, d) => o[0] === a.lng && d[0] === b.lng)
    expect(await ensureDriveTimes(points, roads.clients, 0)).toEqual({ source: 'location', cached: 0, measured: 5, billed: 8, failed: 1 })
    expect(travel(a, b).real).toBe(false)
    expect(travel(b, a).real).toBe(true)
  })

  it('picks the fewest points to measure', () => {
    const [a, b, c] = run(3)
    expect(toMeasure([a, b, c], new Set(['a', 'b']))).toHaveLength(2)
    const have = new Set([`${a.id}>${b.id}`, `${b.id}>${a.id}`])
    expect(toMeasure([a, b, c], have)).toEqual([c])
    const all = new Set([`${a.id}>${b.id}`, `${b.id}>${a.id}`, `${a.id}>${c.id}`, `${c.id}>${a.id}`, `${b.id}>${c.id}`, `${c.id}>${b.id}`])
    expect(toMeasure([a, b, c], all)).toEqual([])
  })

  it('falls back to OSRM when Location Service fails, and says so', async () => {
    const points = run(3)
    const osrm = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'Ok', durations: points.map(() => points.map(() => 600)), distances: points.map(() => points.map(() => 5000)) })),
    )
    expect(await ensureDriveTimes(points, fakeRoads(undefined, true).clients, 0)).toEqual({ source: 'osrm', cached: 0, measured: 0, billed: 0 })
    expect(String(osrm.mock.calls[0][0])).toContain('router.project-osrm.org/table')
    expect(travel(points[0], points[1])).toMatchObject({ minutes: 10, km: 5, real: true })
  })

  it('estimates when neither answers', async () => {
    const points = run(3)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    expect((await ensureDriveTimes(points, fakeRoads(undefined, true).clients, 0)).source).toBe('estimate')
    expect(travel(points[0], points[1]).real).toBe(false)
  })
})

describe('road lines from Location Service', () => {
  it('draws each leg of a path from one route', async () => {
    const path = run(3)
    const roads = fakeRoads()
    expect(await ensureRoadLines([path], roads.clients)).toBe(1)
    expect(roads.routeCalls).toHaveLength(1)
    const legs = legsOf(path)
    expect(Object.keys(legs)).toEqual([`${path[0].id}>${path[1].id}`, `${path[1].id}>${path[2].id}`])
    expect(legs[`${path[0].id}>${path[1].id}`][0]).toEqual([path[0].lng, path[0].lat])
    // known legs are not asked for again
    expect(await ensureRoadLines([path], roads.clients)).toBe(0)
    expect(roads.routeCalls).toHaveLength(1)
  })

  it('draws a path from OSRM when its legs do not match its stops', async () => {
    const path = run(3)
    const roads = fakeRoads()
    const send = roads.clients.geo.send.bind(roads.clients.geo)
    // a route that comes back as one leg cannot be split by stop
    roads.clients.geo.send = (async (cmd: Parameters<typeof send>[0]) => {
      const r = (await send(cmd)) as { Routes: { Legs: unknown[] }[] }
      return { Routes: [{ Legs: r.Routes[0].Legs.slice(0, 1) }] }
    }) as typeof send
    const step = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => ({ steps: [{ geometry: { coordinates: [[a.lng, a.lat], [b.lng, b.lat]] } }] })
    const osrm = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'Ok', routes: [{ legs: [step(path[0], path[1]), step(path[1], path[2])] }] })))
    expect(await ensureRoadLines([path], roads.clients)).toBe(1)
    expect(String(osrm.mock.calls[0][0])).toContain('router.project-osrm.org/route')
    expect(Object.keys(legsOf(path))).toHaveLength(2)
  })
})
