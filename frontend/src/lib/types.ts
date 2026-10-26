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
  /** set when the free lots come from the HDB live feed */
  live?: { free: number; total: number }
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
}
