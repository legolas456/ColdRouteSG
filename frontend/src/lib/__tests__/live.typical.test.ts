import { afterEach, describe, expect, it, vi } from 'vitest'
import TYPICAL_GRID from '../../../../backend/tests/fixtures/typical_grid_expected.json'

/** live.ts as built with (or without) the traffic service. */
async function load(trafficUrl = 'https://api.example.com/api/traffic/grid') {
  vi.resetModules()
  vi.stubEnv('VITE_TRAFFIC_URL', trafficUrl)
  return import('../live')
}

// 03:30 on Thursday 29 Oct in Singapore
const NOW = Date.UTC(2026, 9, 28, 19, 30)

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('typicalTraffic', () => {
  it('asks for the departure today in Singapore, once per departure', async () => {
    const live = await load()
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(TYPICAL_GRID)))
    const typical = await live.typicalTraffic(8 * 60 + 45, NOW)
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.com/api/traffic/typical?at=2026-10-29T08%3A45%3A00%2B08%3A00')
    expect(typical.grid?.typical).toEqual({ dayType: 'weekday', slot: '0845', readings: 3, days: 3 })
    await live.typicalTraffic(8 * 60 + 45, NOW)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("passes on the backend's reason when the slot has none", async () => {
    const live = await load()
    const detail = 'No typical traffic for a weekday at 13:00 yet: it needs at least 3 kept readings in that slot.'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 404 }))
    expect(await live.typicalTraffic(13 * 60, NOW)).toEqual({ grid: null, reason: detail })
  })

  it('is off without the traffic service', async () => {
    const live = await load('')
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect(live.TYPICAL_TRAFFIC_URL).toBeUndefined()
    expect(await live.typicalTraffic(8 * 60 + 45, NOW)).toEqual({ grid: null })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('singaporeTime', () => {
  it("is today's date in Singapore, within the day", async () => {
    const { singaporeTime } = await load()
    expect(singaporeTime(8 * 60 + 45, NOW)).toBe('2026-10-29T08:45:00+08:00')
    // 23:59 on the 28th in Singapore is still the 28th
    expect(singaporeTime(0, Date.UTC(2026, 9, 28, 15, 59))).toBe('2026-10-28T00:00:00+08:00')
    expect(singaporeTime(24 * 60 + 5, NOW)).toBe('2026-10-29T23:59:00+08:00')
  })
})
