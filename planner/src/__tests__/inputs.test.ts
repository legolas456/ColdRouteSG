import { afterEach, describe, expect, it, vi } from 'vitest'
import LIVE_GRID from '../../../backend/tests/fixtures/traffic_grid_expected.json'
import TYPICAL_GRID from '../../../backend/tests/fixtures/typical_grid_expected.json'
import { readInputs, readTypical, type Sources, typicalSlot } from '../inputs'
import { fakeBucket } from './fakes'

// 03:30 on Thursday 29 Oct in Singapore
const THU = Date.UTC(2026, 9, 28, 19, 30)
// 00:30 on Saturday 31 Oct in Singapore, still Friday in UTC
const SAT = Date.UTC(2026, 9, 30, 16, 30)

const src = (objects: Record<string, unknown>): Sources => ({ s3: fakeBucket(objects), bucket: 'coldroute-traffic', trafficKey: 'traffic/speed-grid.json' })

// what data.gov.sg answers, cut to one area
const NEA = {
  area_metadata: [{ name: 'Queenstown', label_location: { latitude: 1.294, longitude: 103.786 } }],
  items: [
    {
      update_timestamp: '2026-10-29T03:20:00+08:00',
      valid_period: { start: '2026-10-29T03:30:00+08:00', end: '2026-10-29T05:30:00+08:00' },
      forecasts: [{ area: 'Queenstown', forecast: 'Light Rain' }],
    },
  ],
}
const CARPARKS = {
  version: 1,
  fetchedAt: '2026-10-29T03:25:00+08:00',
  carparks: [{ id: 'LTA-1', agency: 'LTA', name: 'Suntec City', lat: 1.29375, lng: 103.85718, free: 2917 }],
}

afterEach(() => vi.restoreAllMocks())

describe('typicalSlot', () => {
  it("is the departure's 15-minute slot, on today's date in Singapore", () => {
    expect(typicalSlot(8 * 60 + 52, THU)).toEqual({ dayType: 'weekday', slot: '0845' })
    expect(typicalSlot(9 * 60, SAT)).toEqual({ dayType: 'weekend', slot: '0900' })
    expect(typicalSlot(24 * 60 + 30, THU).slot).toBe('2345')
    expect(typicalSlot(-5, THU).slot).toBe('0000')
  })
})

// the index the nightly build writes when it published the weekday 08:45 slot
const INDEX = { 'traffic/typical/index.json': { slots: { weekday: { '0845': { readings: 3, days: 3 } }, weekend: {} } } }

describe('readTypical', () => {
  it('reads the slot a departure falls in', async () => {
    const t = await readTypical(src({ ...INDEX, 'traffic/typical/weekday/0845.json': TYPICAL_GRID }), 8 * 60 + 50, THU)
    expect(t.grid?.typical).toEqual({ dayType: 'weekday', slot: '0845', readings: 3, days: 3 })
    expect(t.raw).toEqual(TYPICAL_GRID)
  })

  it('leaves out a slot the last nightly build did not publish', async () => {
    // an older build's grid is still in the bucket
    const old = { 'traffic/typical/weekday/0845.json': TYPICAL_GRID }
    expect((await readTypical(src({ ...old, 'traffic/typical/index.json': { slots: { weekday: { '0900': {} }, weekend: {} } } }), 8 * 60 + 50, THU)).grid).toBeNull()
    // and before the first build there is no index at all
    expect((await readTypical(src(old), 8 * 60 + 50, THU)).grid).toBeNull()
  })

  it('gives the reason the backend gives when the slot has none yet', async () => {
    expect(await readTypical(src({}), 13 * 60, THU)).toEqual({
      grid: null,
      raw: null,
      reason: 'No typical traffic for a weekday at 13:00 yet: it needs at least 3 kept readings in that slot.',
    })
  })
})

describe('readInputs', () => {
  it('reads the public feeds, and the carparks and road speeds our jobs publish', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (String(url).includes('weather') ? new Response(JSON.stringify(NEA)) : new Response('', { status: 503 })))
    const { feeds, rawTraffic } = await readInputs(src({ 'traffic/speed-grid.json': LIVE_GRID, 'parking/carparks.json': CARPARKS }), THU)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(feeds.weather.data?.areas).toEqual([{ area: 'Queenstown', forecast: 'Light rain', lng: 103.786, lat: 1.294, rain: 1 }])
    expect(feeds.carparks).toEqual({ status: 'error', error: 'HTTP 503' })
    expect(feeds.ltaCarparks?.data?.carparks).toHaveLength(1)
    expect(feeds.traffic.data?.stretches).toBe(10)
    expect(rawTraffic).toEqual(LIVE_GRID)
    expect(feeds.cameras).toEqual({ status: 'idle' })
    expect(feeds.fetchedAt).toBe(THU)
  })

  it('leaves out what is not published yet, and says what failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    const { feeds, rawTraffic } = await readInputs(src({}), THU)
    expect(feeds.weather).toEqual({ status: 'error', error: 'fetch failed' })
    expect(feeds.traffic).toEqual({ status: 'idle' })
    expect(feeds.ltaCarparks).toEqual({ status: 'idle' })
    expect(rawTraffic).toBeNull()

    const denied = { send: async () => Promise.reject(Object.assign(new Error('Access Denied'), { name: 'AccessDenied' })) }
    const out = await readInputs({ ...src({}), s3: denied }, THU)
    expect(out.feeds.traffic).toEqual({ status: 'error', error: 'Access Denied' })
  })
})
