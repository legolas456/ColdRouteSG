export type Cargo = 'PHARMA' | 'FROZEN' | 'CHILLED'

export type ProfileId = 'pharma' | 'balanced' | 'fastest'

export interface Carpark {
  name: string
  lng: number
  lat: number
  distanceKm: number
  freePct: number
  /** 0–1, derived from walking distance and live availability */
  risk: number
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
  /** 0–1 proxy from LTA speed bands on the approach */
  trafficRisk: number
  review?: { query: string; candidates: string[] }
}

export interface Depot {
  id: 'D'
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
  T: number
  C: number
  L: number
}

export interface StopResult {
  id: string
  seq: number
  legMinutes: number
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
  /** weighted cost contributions, minute-equivalents */
  cost: { weather: number; parking: number; traffic: number; cold: number; lateness: number }
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
}
