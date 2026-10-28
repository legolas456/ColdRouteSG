import { describe, expect, it } from 'vitest'
import { parseLtaCarparks } from '../live'

// what GET /api/parking/carparks returns (backend/app/services/parking.py carpark_feed)
const FEED = {
  version: 1,
  source: 'LTA DataMall Carpark Availability',
  fetchedAt: '2026-10-29T05:10:00+08:00',
  carparks: [
    { id: 'LTA-1', agency: 'LTA', name: 'Suntec City', lat: 1.29375, lng: 103.85718, free: 2917 },
    { id: 'URA-A0007', agency: 'URA', name: 'ANGULLIA PARK OFF ST', lat: 1.3053, lng: 103.8296, free: 224 },
  ],
}

describe('parseLtaCarparks', () => {
  it('reads the carparks our backend publishes', () => {
    const f = parseLtaCarparks(FEED)
    expect(f.updated).toBe(5 * 60 + 10)
    expect(f.carparks).toEqual([
      { no: 'LTA-1', address: 'Suntec City', lng: 103.85718, lat: 1.29375, free: 2917, agency: 'LTA' },
      { no: 'URA-A0007', address: 'ANGULLIA PARK OFF ST', lng: 103.8296, lat: 1.3053, free: 224, agency: 'URA' },
    ])
  })

  it('skips carparks it cannot place or count, and HDB ones', () => {
    const f = parseLtaCarparks({
      ...FEED,
      carparks: [{ id: 'x', agency: 'HDB', lat: 1.3, lng: 103.8, free: 3 }, { id: 'y', agency: 'URA', lat: '1.3', lng: 103.8, free: 3 }, { id: 'z', agency: 'URA', lat: 1.3, lng: 103.8 }],
    })
    expect(f.carparks).toEqual([])
    expect(parseLtaCarparks({ ...FEED, carparks: [{ ...FEED.carparks[0], free: -2 }] }).carparks[0].free).toBe(0)
  })

  it('refuses a feed without a time', () => {
    expect(() => parseLtaCarparks({ ...FEED, fetchedAt: undefined })).toThrow('fetchedAt')
  })
})
