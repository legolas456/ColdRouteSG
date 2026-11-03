import { RAIN_CELLS, RECORDED_AT } from '../data/sample'
import { kmBetween, nearest, parkingRisk } from './geo'
import type { Camera, LiveCarpark, LiveFeeds, LtaCarpark, WeatherArea } from './feeds'
import { hm } from './time'
import type { TrafficGrid } from './traffic'
import type { Carpark, RainCell, RoadsUsed, Stop } from './types'

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
  /** live road speeds the plan uses; null when it uses OSRM's free-flow drive times */
  traffic: TrafficGrid | null
  /** plain-English caveats, shown in the Conditions panel */
  notes: string[]
  /** set when the cloud planner (planner/ on AWS Lambda) made the plan: where its drive times came from, and how long it took */
  cloud?: { roads: RoadsUsed['source']; ms: number }
}

/**
 * Live road speeds describe the roads now. They stand in for the whole run only
 * if it leaves within this many minutes of the reading.
 */
export const TRAFFIC_HORIZON_MIN = 60
/** A reading older than this is no longer live. */
export const TRAFFIC_MAX_AGE_MIN = 20

/** Minutes from `b` to `a` on a 24-hour clock, between -720 and 719. */
const clockDiff = (a: number, b: number) => ((((a - b + 720) % 1440) + 1440) % 1440) - 720

/** The reading the plan may use, or why not. */
export function trafficFor(feed: LiveFeeds['traffic'], now: number, departure?: number): { traffic: TrafficGrid | null; note?: string } {
  const grid = feed.data
  if (!grid) {
    // the backend explains itself in a sentence (e.g. no LTA key); a network failure is a bare phrase
    const reason = !feed.error ? '' : feed.error.endsWith('.') ? ` ${feed.error}` : ` The traffic service did not answer (${feed.error}).`
    return feed.status === 'error'
      ? { traffic: null, note: `Live road speeds are unavailable, so drive times assume free-flowing traffic.${reason}` }
      : { traffic: null }
  }
  if (clockDiff(now, grid.at) > TRAFFIC_MAX_AGE_MIN) {
    return { traffic: null, note: `The LTA road speeds are from ${hm(grid.at)}, too old to use, so drive times assume free-flowing traffic.` }
  }
  if (departure !== undefined && Math.abs(clockDiff(departure, grid.at)) > TRAFFIC_HORIZON_MIN) {
    return {
      traffic: null,
      note: `LTA road speeds show traffic at ${hm(grid.at)}. A run leaving at ${hm(departure)} is planned with free-flowing traffic; use Now to plan with current traffic.`,
    }
  }
  return { traffic: grid }
}

type Point = { lng: number; lat: number }

/** Short map and timeline label for a live NEA forecast. */
const rainLabel = (a: WeatherArea) =>
  a.rain === 2 ? (/thunder/i.test(a.forecast) ? 'Thundery showers' : 'Heavy rain') : /shower/i.test(a.forecast) ? 'Showers' : 'Light rain'

/**
 * URA and mall carparks (LTA) report free lots but not their size. A van needs
 * one lot, so their risk counts this many free lots as plenty (100% free) and
 * fewer in proportion: 25 free reads as 50%.
 */
export const PLENTY_LOTS = 50

function liveCarpark(c: LiveCarpark | LtaCarpark, stop: Point): Carpark {
  const distanceKm = Math.max(0.05, Math.round(kmBetween(c, stop) * 20) / 20)
  const sized = 'total' in c
  const freePct = sized ? Math.round((c.free / c.total) * 100) : Math.min(100, Math.round((c.free / PLENTY_LOTS) * 100))
  return {
    name: c.address,
    code: c.no,
    lng: c.lng,
    lat: c.lat,
    distanceKm,
    freePct,
    risk: parkingRisk(distanceKm, freePct),
    live: sized ? { free: c.free, total: c.total } : { free: c.free },
    ...(!sized && { agency: c.agency }),
  }
}

export function recordedConditions(stops: Stop[]): Conditions {
  return { mode: 'recorded', source: 'recorded', at: RECORDED_AT, rain: RAIN_CELLS, stops, traffic: null, notes: [] }
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
/**
 * URA and mall free lots older than this are no longer live: the traffic
 * refresh publishes them every 10 minutes, so this is two missed runs. Plans
 * then use the HDB carparks.
 */
export const LTA_PARKING_MAX_AGE_MIN = 30

/** LTA's URA and mall carparks while their lots are fresh enough to plan with, else null. */
export function freshLtaCarparks(feeds: Pick<LiveFeeds, 'ltaCarparks' | 'fetchedAt'>) {
  const lta = feeds.ltaCarparks?.data
  return lta && (feeds.fetchedAt ?? Date.now()) - lta.fetchedAt <= LTA_PARKING_MAX_AGE_MIN * 60_000 ? lta : null
}

export function liveConditions(stops: Stop[], feeds: LiveFeeds, now: number, departure?: number, typical?: TypicalTraffic): Conditions {
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
  // HDB carparks (data.gov.sg) and, while fresh, URA and mall carparks (LTA): the nearest counts
  const lta = feeds.ltaCarparks?.data
  const fresh = freshLtaCarparks(feeds)
  const parks: (LiveCarpark | LtaCarpark)[] = [...(feeds.carparks.data?.carparks ?? []), ...(fresh?.carparks ?? [])]
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
  if (lta && !fresh) notes.push(`LTA's URA and mall carpark lots are from ${hm(lta.updated)}, too old to use, so parking uses the HDB carparks.`)
  if (!parks.length) notes.push('The HDB carpark feed did not load, so parking uses the recorded values.')
  // the forecast only covers the next two hours; a run outside it is planned dry
  if (departure !== undefined && rain.length && (departure + 5 * 60 < w.validFrom || departure > w.validTo)) {
    notes.push(
      `NEA forecasts ${hm(w.validFrom)}–${hm(w.validTo)} only. A run leaving at ${hm(departure)} is planned without rain; use Now to plan from the current time.`,
    )
  }
  const live = trafficFor(feeds.traffic, now, departure)
  const { traffic, note } = live.traffic || !typical ? live : withTypical(live.note, typical)
  if (note) notes.push(note)
  return { mode: 'live', source: parks.length ? 'live' : 'mixed', at: now, rain, stops: out, traffic, notes }
}

/** Typical traffic for a departure (backend /api/traffic/typical), or why there is none. */
export interface TypicalTraffic {
  grid: TrafficGrid | null
  reason?: string
}

/** Whether a plan should ask for typical traffic: no live reading stands for its departure. */
export const wantsTypical = (feed: LiveFeeds['traffic'], now: number, departure?: number) => trafficFor(feed, now, departure).traffic === null

/** When no live reading stands for the departure, the typical traffic of its slot does, if there is one. */
function withTypical(liveNote: string | undefined, typical: TypicalTraffic): { traffic: TrafficGrid | null; note?: string } {
  const g = typical.grid
  if (g?.typical) {
    const { dayType, readings, days } = g.typical
    return {
      traffic: g,
      note: `No live LTA reading covers this departure, so the plan uses typical ${dayType} traffic at ${hm(g.at)}: the median of ${readings} kept readings over ${days} day${days === 1 ? '' : 's'}.`,
    }
  }
  return { traffic: null, note: [liveNote, typical.reason].filter(Boolean).join(' ') || undefined }
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

/** A carpark's free lots in words: "120/400 lots free" (HDB), "230 lots free" (URA, malls) or "62% free". */
export function lotsLabel(p: Carpark) {
  if (p.live?.total) return `${p.live.free}/${p.live.total} lots free`
  if (p.live) return `${p.live.free} lots free`
  return `${p.freePct}% free${p.estimated ? ' (assumed)' : ''}`
}

/** Where a stop's parking figures come from. */
export const parkingSource = (p: Carpark) => (p.agency ? `${p.agency} live` : p.live ? 'HDB live' : p.estimated ? 'Estimate' : 'Recorded')
