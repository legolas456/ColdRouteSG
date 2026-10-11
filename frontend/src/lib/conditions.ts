import { RAIN_CELLS, RECORDED_AT } from '../data/sample'
import { kmBetween, nearest, parkingRisk } from './geo'
import type { Camera, LiveFeeds, LiveCarpark, WeatherArea } from './live'
import { hm } from './time'
import type { Carpark, RainCell, Stop } from './types'

export type DataMode = 'live' | 'recorded'

/**
 * Everything a plan is built on besides the stops themselves: where it rains
 * and when, and each stop's forecast and nearest carpark.
 */
export interface Conditions {
  /** what the dispatcher asked for */
  mode: DataMode
  /** what the plan actually reads; "mixed" when one live feed failed */
  source: 'live' | 'mixed' | 'recorded'
  /** minutes after midnight: when the data was read */
  at: number
  rain: RainCell[]
  /** the stops with live area, forecast and parking applied */
  stops: Stop[]
  /** plain-English caveats, shown in the Conditions panel */
  notes: string[]
}

type Point = { lng: number; lat: number }

/** Short map and timeline label for a live NEA forecast. */
const rainLabel = (a: WeatherArea) =>
  a.rain === 2 ? (/thunder/i.test(a.forecast) ? 'Thundery showers' : 'Heavy rain') : /shower/i.test(a.forecast) ? 'Showers' : 'Light rain'

function liveCarpark(c: LiveCarpark, stop: Point): Carpark {
  const distanceKm = Math.max(0.05, Math.round(kmBetween(c, stop) * 20) / 20)
  const freePct = Math.round((c.free / c.total) * 100)
  return {
    name: c.address,
    code: c.no,
    lng: c.lng,
    lat: c.lat,
    distanceKm,
    freePct,
    risk: parkingRisk(distanceKm, freePct),
    live: { free: c.free, total: c.total },
  }
}

export function recordedConditions(stops: Stop[]): Conditions {
  return { mode: 'recorded', source: 'recorded', at: RECORDED_AT, rain: RAIN_CELLS, stops, notes: [] }
}

/**
 * A van parks at an HDB carpark only if it is a short trolley walk away;
 * further than this, the stop keeps its own loading bay (malls, hospitals and
 * offices have one, and the HDB feed does not cover them).
 */
export const MAX_WALK_KM = 0.6

/**
 * Live mode. Rain comes from the NEA 2-hour forecast: every area that expects
 * rain becomes a cell over its forecast period. Each stop takes the forecast of
 * its nearest NEA area and the nearest HDB carpark that reports live lots, if
 * that carpark is within MAX_WALK_KM.
 * Without the forecast there is no live plan, so it falls back to recorded.
 */
export function liveConditions(stops: Stop[], feeds: LiveFeeds, now: number, departure?: number): Conditions {
  const w = feeds.weather.data
  if (!w) {
    const failed = feeds.weather.status === 'error'
    return {
      ...recordedConditions(stops),
      mode: 'live',
      notes: [failed ? 'The NEA forecast did not load, so the plan uses the recorded morning.' : 'Reading the live feeds…'],
    }
  }
  const rain: RainCell[] = w.areas
    .filter((a) => a.rain > 0)
    .map((a) => ({
      area: a.area,
      label: rainLabel(a),
      start: w.validFrom,
      end: w.validTo,
      center: [a.lng, a.lat],
      radiusKm: a.rain === 2 ? 2.5 : 2,
      heavy: a.rain === 2,
    }))
  const parks = feeds.carparks.data?.carparks ?? []
  const out = stops.map((s) => {
    const area = nearest(w.areas, s)?.item
    const park = nearest(parks, s)
    return {
      ...s,
      area: area?.area ?? s.area,
      forecast: area?.forecast ?? s.forecast,
      parking: park && park.km <= MAX_WALK_KM ? liveCarpark(park.item, s) : s.parking,
    }
  })
  const notes: string[] = []
  if (!parks.length) notes.push('The HDB carpark feed did not load, so parking uses the recorded values.')
  // the forecast only covers the next two hours; a run outside it is planned dry
  if (departure !== undefined && rain.length && (departure + 5 * 60 < w.validFrom || departure > w.validTo)) {
    notes.push(
      `NEA forecasts ${hm(w.validFrom)}–${hm(w.validTo)} only. A run leaving at ${hm(departure)} is planned without rain; use Now to plan from the current time.`,
    )
  }
  return { mode: 'live', source: parks.length ? 'live' : 'mixed', at: now, rain, stops: out, notes }
}


/** The rain cell over a stop's area, if any. */
export const rainFor = (stop: Pick<Stop, 'area'>, rain: RainCell[]) => rain.find((c) => c.area === stop.area)

/** "the City" reads better than "City"; NEA's other areas are place names. */
export const areaName = (area: string) => (area === 'City' ? 'the City' : area)

/** Traffic cameras nearest to a point, closest first. */
export function camerasNear(cameras: Camera[], p: Point, maxKm = 3, limit = 1) {
  return cameras
    .map((c) => ({ camera: c, km: kmBetween(c, p) }))
    .filter((c) => c.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
}
