import { describe, expect, it } from 'vitest'
import { SAMPLE_STOPS } from '../../data/sample'
import TYPICAL_GRID from '../../../../backend/tests/fixtures/typical_grid_expected.json'
import { liveConditions, recordedConditions, TRAFFIC_HORIZON_MIN, TRAFFIC_MAX_AGE_MIN, trafficFor, wantsTypical } from '../conditions'
import type { LiveFeeds } from '../live'
import { parseTrafficGrid } from '../traffic'

const reading = (fetchedAt: string) =>
  parseTrafficGrid({ fetchedAt, origin: [103.55, 1.15], cellDeg: 0.01, stretches: 1, slowShare: 0, cells: [[30, 15, 2, 1]] })
const at0830 = reading('2026-10-27T08:30:00+08:00')
const READ = 8 * 60 + 30
const ok = { status: 'ok' as const, data: at0830 }

describe('trafficFor: when live road speeds may stand in for a run', () => {
  it('uses a fresh reading for a run leaving within the hour', () => {
    expect(trafficFor(ok, READ + 5, READ + 30)).toEqual({ traffic: at0830 })
    expect(trafficFor(ok, READ + 5, READ + TRAFFIC_HORIZON_MIN).traffic).toBe(at0830)
    // a run that left half an hour ago is still on the same roads
    expect(trafficFor(ok, READ + 5, READ - 30).traffic).toBe(at0830)
    expect(trafficFor(ok, READ + 5).traffic).toBe(at0830)
  })

  it('plans a later run with free-flowing traffic and says why', () => {
    const { traffic, note } = trafficFor(ok, READ + 5, READ + TRAFFIC_HORIZON_MIN + 1)
    expect(traffic).toBeNull()
    expect(note).toContain('08:30')
    expect(note).toContain('09:31')
    expect(note).toContain('Now')
  })

  it('drops a reading that is no longer live', () => {
    expect(trafficFor(ok, READ + TRAFFIC_MAX_AGE_MIN, READ + 30).traffic).toBe(at0830)
    const { traffic, note } = trafficFor(ok, READ + TRAFFIC_MAX_AGE_MIN + 1, READ + 30)
    expect(traffic).toBeNull()
    expect(note).toContain('too old')
  })

  it('counts minutes across midnight', () => {
    const late = { status: 'ok' as const, data: reading('2026-10-27T23:55:00+08:00') }
    // read 23:55, now 00:05, leaving 00:10: ten minutes old, fifteen minutes ahead
    expect(trafficFor(late, 5, 10).traffic).toBe(late.data)
    expect(trafficFor(late, 5, 23 * 60).traffic).toBe(late.data)
    expect(trafficFor(late, 5, 22 * 60 + 30).traffic).toBeNull()
    expect(trafficFor(late, 23 * 60 + 55 + 30, 0).traffic).toBeNull()
  })

  it('says nothing when traffic is not set up, and why when it failed', () => {
    expect(trafficFor({ status: 'idle' }, READ, READ)).toEqual({ traffic: null })
    expect(trafficFor({ status: 'loading' }, READ, READ)).toEqual({ traffic: null })
    const failed = trafficFor({ status: 'error', error: 'No LTA DataMall AccountKey is configured (set LTA_ACCOUNT_KEY).' }, READ, READ)
    expect(failed.traffic).toBeNull()
    expect(failed.note).toContain('No LTA DataMall AccountKey')
    expect(failed.note).toContain('free-flowing')
    // a network failure is a bare phrase, not a sentence
    expect(trafficFor({ status: 'error', error: 'Timed out' }, READ, READ).note).toContain('did not answer (Timed out).')
  })

  it('keeps the last good reading through a failed refresh while it is still fresh', () => {
    // live.ts keeps data on error so a flaky refresh does not blank the plan
    expect(trafficFor({ status: 'error', error: 'HTTP 503', data: at0830 }, READ + 5, READ + 10).traffic).toBe(at0830)
  })
})

const feeds = (traffic: LiveFeeds['traffic']): LiveFeeds => ({
  weather: {
    status: 'ok',
    data: { updated: READ, validFrom: READ, validTo: READ + 120, areas: [{ area: 'Queenstown', forecast: 'Fair', lng: 103.78, lat: 1.29, rain: 0 }] },
  },
  carparks: { status: 'ok', data: { updated: READ, carparks: [], reporting: 0, totalLots: 0, freeLots: 0 } },
  cameras: { status: 'idle' },
  traffic,
})

describe('conditions carry the reading to the plan', () => {
  it('live mode passes a usable reading through', () => {
    const c = liveConditions(SAMPLE_STOPS, feeds(ok), READ + 2, READ + 15)
    expect(c.traffic).toBe(at0830)
    expect(c.notes.join(' ')).not.toContain('road speeds')
  })

  it('live mode leaves it out for a later run and notes it', () => {
    const c = liveConditions(SAMPLE_STOPS, feeds(ok), READ + 2, 13 * 60)
    expect(c.traffic).toBeNull()
    expect(c.notes.some((n) => n.includes('LTA road speeds'))).toBe(true)
  })

  it('the recorded morning never uses live road speeds', () => {
    expect(recordedConditions(SAMPLE_STOPS).traffic).toBeNull()
  })
})

describe('typical traffic stands in when no live reading does', () => {
  const typical0845 = parseTrafficGrid(TYPICAL_GRID)

  it('a later run uses the typical traffic of its slot, and says so', () => {
    const c = liveConditions(SAMPLE_STOPS, feeds(ok), READ + 2, 13 * 60, { grid: typical0845 })
    expect(c.traffic).toBe(typical0845)
    const notes = c.notes.join(' ')
    expect(notes).toContain('typical weekday traffic at 08:45')
    expect(notes).toContain('the median of 3 kept readings over 3 days')
    expect(notes).not.toContain('free-flowing')
  })

  it('a live reading that covers the departure wins', () => {
    expect(liveConditions(SAMPLE_STOPS, feeds(ok), READ + 2, READ + 15, { grid: typical0845 }).traffic).toBe(at0830)
  })

  it('also stands in when the live feed failed', () => {
    const c = liveConditions(SAMPLE_STOPS, feeds({ status: 'error', error: 'Timed out' }), READ, READ + 10, { grid: typical0845 })
    expect(c.traffic).toBe(typical0845)
  })

  it('without a typical grid the run is free-flowing, with both reasons', () => {
    const reason = 'No typical traffic for a weekday at 13:00 yet: it needs at least 3 kept readings in that slot.'
    const c = liveConditions(SAMPLE_STOPS, feeds(ok), READ + 2, 13 * 60, { grid: null, reason })
    expect(c.traffic).toBeNull()
    const notes = c.notes.join(' ')
    expect(notes).toContain('LTA road speeds show traffic at 08:30')
    expect(notes).toContain(reason)
  })

  it('asks for typical traffic only when no live reading stands for the departure', () => {
    expect(wantsTypical(ok, READ + 2, READ + 15)).toBe(false)
    expect(wantsTypical(ok, READ + 2, 13 * 60)).toBe(true)
    expect(wantsTypical(ok, READ + TRAFFIC_MAX_AGE_MIN + 1, READ + 30)).toBe(true)
    expect(wantsTypical({ status: 'error', error: 'Timed out' }, READ, READ)).toBe(true)
  })
})
