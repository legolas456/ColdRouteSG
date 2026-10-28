import { afterEach, describe, expect, it, vi } from 'vitest'
import LIVE_GRID from '../../../backend/tests/fixtures/traffic_grid_expected.json'
import TYPICAL_GRID from '../../../backend/tests/fixtures/typical_grid_expected.json'
import { DEPOT, SAMPLE_STOPS } from '../../../frontend/src/data/sample'
import type { LiveFeeds } from '../../../frontend/src/lib/feeds'
import { parseTrafficGrid } from '../../../frontend/src/lib/traffic'
import { plan, type PlanDeps } from '../plan'
import type { PlanRequest } from '../request'
import { fakeRoads } from './fakes'

// 08:35 on Tuesday 27 Oct in Singapore, five minutes after the live reading
const NOW = Date.UTC(2026, 9, 27, 0, 35)
// ids of their own: the sample's are in the console's OSRM snapshot
const RUN: PlanRequest = { depot: { ...DEPOT, id: 'D2' }, stops: SAMPLE_STOPS.slice(0, 4).map((s) => ({ ...s, id: `${s.id}2` })), departure: 9 * 60, profile: 'pharma' }
const TYPICAL_1300 = { ...TYPICAL_GRID, slot: '1300' }

const feeds = (): LiveFeeds => ({
  weather: { status: 'ok', data: { updated: 510, validFrom: 510, validTo: 630, areas: [{ area: 'Queenstown', forecast: 'Fair', lng: 103.78, lat: 1.29, rain: 0 }] } },
  carparks: { status: 'ok', data: { updated: 510, carparks: [], reporting: 0, totalLots: 0, freeLots: 0 } },
  ltaCarparks: { status: 'idle' },
  cameras: { status: 'idle' },
  traffic: { status: 'ok', data: parseTrafficGrid(LIVE_GRID) },
  fetchedAt: NOW,
})

const deps = (roads = fakeRoads()) => {
  const typical = vi.fn(async () => ({ grid: parseTrafficGrid(TYPICAL_1300), raw: TYPICAL_1300 }))
  const d: PlanDeps = { inputs: async () => ({ feeds: feeds(), rawTraffic: LIVE_GRID }), typical, roads: roads.clients, now: () => NOW }
  return { d, typical, roads }
}

afterEach(() => vi.restoreAllMocks())

describe('plan', () => {
  it('plans a run leaving soon with live traffic and Location Service drive times', async () => {
    const { d, typical, roads } = deps()
    const r = await plan(RUN, d)
    expect(typical).not.toHaveBeenCalled()
    expect(r.conditions.traffic).toEqual(LIVE_GRID)
    expect(r.result.recommended.order.slice().sort()).toEqual(RUN.stops.map((s) => s.id).sort())
    expect(r.result.baseline.order).toHaveLength(4)
    // a full matrix, less the column the rows already cover, and a route for each plan
    expect(r.roads).toEqual({ source: 'location', cached: 0, measured: 20, billed: 4 * 5 + 1 * 4 + roads.routeCalls.length })
    expect(roads.routeCalls.length).toBeGreaterThanOrEqual(1)
    const first = `D2>${r.result.recommended.order[0]}`
    expect(r.legs[first][0]).toEqual([DEPOT.lng, DEPOT.lat])
    expect(r.conditions.notes.join(' ')).not.toContain('Location Service')
    // every pair's measured time, for the console's table
    expect(r.times).toHaveLength(5 * 4)
    expect(r.times.find((t) => t.from === 'D2' && t.to === r.result.recommended.order[0])?.minutes).toBeGreaterThan(0)
    // what the console reads back is what was sent
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })

  it("plans a later departure with that slot's typical traffic", async () => {
    const { d, typical } = deps()
    const r = await plan({ ...RUN, departure: 13 * 60 }, d)
    expect(typical).toHaveBeenCalledWith(13 * 60)
    expect(r.conditions.traffic).toEqual(TYPICAL_1300)
    expect(r.conditions.notes.join(' ')).toContain('typical weekday traffic at 13:00')
  })

  it('says when drive times did not come from Location Service', async () => {
    const roads = fakeRoads(undefined, true)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    const { d } = deps(roads)
    const r = await plan({ ...RUN, stops: [{ ...RUN.stops[0], id: 'elsewhere', lat: 1.4 }] }, d)
    expect(r.roads.source).toBe('estimate')
    expect(r.conditions.notes).toContain('Neither Amazon Location Service nor OSRM answered, so drive times are estimated from straight-line distance.')
  })
})
