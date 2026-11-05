import { afterEach, describe, expect, it, vi } from 'vitest'
import snapshot from '../../data/osrm.json'
import { DEPOT, SAMPLE_STOPS } from '../../data/sample'
import { ensureMatrix, restoreRecordedTimes, setDriveTimes, travel } from '../roads'

const bundled = (snapshot as unknown as { minutes: Record<string, Record<string, number>> }).minutes

afterEach(() => vi.unstubAllGlobals())

describe('recorded drive times', () => {
  it('puts the bundled times back after a live or cloud plan overwrote them', () => {
    const stop = SAMPLE_STOPS[0]
    const recorded = bundled[DEPOT.id][stop.id]
    setDriveTimes([DEPOT, stop], [{ from: DEPOT.id, to: stop.id, minutes: 999, km: 1 }])
    expect(travel(DEPOT, stop).minutes).toBe(999)
    restoreRecordedTimes([DEPOT, stop])
    expect(travel(DEPOT, stop).minutes).toBe(recorded)
  })

  it('leaves a sample id alone once it has moved', () => {
    const stop = SAMPLE_STOPS[1]
    const moved = { ...stop, lng: stop.lng + 0.05 }
    restoreRecordedTimes([DEPOT, moved])
    expect(travel(DEPOT, moved).real).toBe(false)
  })
})

describe('OSRM replies that arrive out of order', () => {
  it('keeps the drive times for where the stop is now', async () => {
    const replies: Array<(minutes: number) => void> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((done) =>
            replies.push((minutes) =>
              done({ ok: true, json: async () => ({ code: 'Ok', durations: [[0, minutes * 60], [minutes * 60, 0]], distances: [[0, 1000], [1000, 0]] }) }),
            ),
          ),
      ),
    )
    const other = { id: 'OTHER', lng: 103.85, lat: 1.3 }
    const before = { id: 'REUSED', lng: 103.75, lat: 1.35 }
    const after = { id: 'REUSED', lng: 103.95, lat: 1.35 }
    const old = ensureMatrix([before, other])
    const latest = ensureMatrix([after, other])
    replies[1](30)
    await latest
    replies[0](5)
    await old
    expect(travel(after, other).minutes).toBe(30)
    expect(travel(other, after).minutes).toBe(30)
  })
})
