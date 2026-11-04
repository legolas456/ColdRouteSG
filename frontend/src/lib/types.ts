import type { Conditions } from './conditions'

export type Cargo = 'PHARMA' | 'FROZEN' | 'CHILLED'

export type ProfileId = 'pharma' | 'balanced' | 'fastest'

export interface Carpark {
  name: string
  /** HDB carpark number, when the carpark comes from the live feed */
  code?: string
  lng: number
  lat: number
  distanceKm: number
  freePct: number
  /** 0–1, derived from walking distance and live availability */
  risk: number
  /** set when the free lots are live; URA and mall carparks (LTA) report no total */
  live?: { free: number; total?: number }
  /** set for URA and mall carparks from LTA DataMall; HDB carparks have none */
  agency?: 'URA' | 'LTA'
  /** a stop added by search, before live data: free lots are assumed */
  estimated?: boolean
}

export interface Stop {
  id: string
  name: string
  short: string
  address: string
  lng: number
  lat: number
  /** minutes after midnight */
  windowStart: number
  windowEnd: number
  service: number
  cargo: Cargo
  area: string
  forecast: string
  parking: Carpark
  review?: { query: string; candidates: string[] }
}

export interface Depot {
  /** Sample depot is D; selected depots use a coordinate-specific ID for road-cache isolation. */
  id: string
  name: string
  address: string
  lng: number
  lat: number
}

export interface RainCell {
  area: string
  label: string
  start: number
  end: number
  center: [number, number]
  radiusKm: number
  /** heavy or thundery: drawn stronger on the map */
  heavy: boolean
}

export interface Weights {
  drive: number
  late: number
  weather: number
  parking: number
  cold: number
}

export interface RiskFactors {
  W: number
  P: number
  /** 0–1 from the live-traffic delay on the approach; 0 when traffic is not measured */
  T: number
  C: number
  L: number
}

export interface StopResult {
  id: string
  seq: number
  /** drive time of the approach, with live traffic when the plan has it */
  legMinutes: number
  /** minutes live traffic adds to the approach; 0 when traffic is not measured */
  trafficMinutes: number
  legKm: number
  arrival: number
  start: number
  finish: number
  wait: number
  late: number
  slack: number
  inRain: boolean
  exposure: number
  risk: RiskFactors
  riskScore: number
  /** weighted contributions to the normalised route objective */
  cost: { drive: number; late: number; weather: number; parking: number; cold: number }
}

export interface Plan {
  order: string[]
  rows: StopResult[]
  byId: Record<string, StopResult>
  drive: number
  km: number
  lateMinutes: number
  lateStops: number
  exposure: number
  rainStops: number
  cost: number
  end: number
}

export interface OptimiseResult {
  baseline: Plan
  recommended: Plan
  evaluated: number
  elapsedMs: number
  highestRiskId: string
  /** minutes after midnight of the LTA road speeds the plan used; null when it used none */
  trafficAt: number | null
  /** what those road speeds were: one live reading, or typical traffic for the departure's slot */
  trafficKind: 'live' | 'typical' | null
}

/** A drive time between two points, as OSRM or Amazon Location Service measured it. */
export interface DriveTime {
  from: string
  to: string
  minutes: number
  km: number
}

/** Where a cloud plan's drive times came from, and what Location Service bills for them. */
export interface RoadsUsed {
  source: 'location' | 'osrm' | 'estimate'
  /** pairs read from the planner's cache, and pairs Location Service measured */
  cached: number
  measured: number
  /** routes Location Service bills for: every cell of a matrix (a stop to itself too), and each route drawn */
  billed: number
  /** pairs Location Service could not route, so the plan estimates them from straight-line distance */
  failed?: number
}

/** What the cloud planner (planner/, POST /api/plan) answers. */
export interface PlanResponse {
  result: OptimiseResult
  /** what the plan read; `traffic` is the road-speed grid as published, since JSON has no Map */
  conditions: Omit<Conditions, 'traffic' | 'cloud'> & { traffic: Record<string, unknown> | null }
  /** road lines of both plans' legs, keyed "fromId>toId" */
  legs: Record<string, [number, number][]>
  /** the measured drive times the plan used, for the console's own table */
  times: DriveTime[]
  roads: RoadsUsed
  elapsedMs: number
}
