import { parkingRisk } from '../lib/geo'
import type { Depot, ProfileId, RainCell, Stop, Weights } from '../lib/types'

/**
 * The recorded morning: a rainy Friday, read at 09:05. Recorded mode replays it
 * so the demo case never changes; the values are sample data, not a capture.
 */
export const RECORDED_AT = 545
export const RECORDED_DATE = 'Fri 10 Oct'

export const DEPOT: Depot = {
  id: 'D',
  name: 'Jurong Cold Store',
  address: '9 Fishery Port Rd, 619742',
  lng: 103.7205,
  lat: 1.3088,
}

const park = (name: string, lng: number, lat: number, distanceKm: number, freePct: number) => ({
  name,
  lng,
  lat,
  distanceKm,
  freePct,
  risk: parkingRisk(distanceKm, freePct),
})

export const SAMPLE_STOPS: Stop[] = [
  {
    id: 'NUH',
    name: 'NUH Pharmacy',
    short: 'NUH',
    address: '5 Lower Kent Ridge Rd, 119074',
    lng: 103.783,
    lat: 1.294,
    windowStart: 570,
    windowEnd: 630,
    service: 12,
    cargo: 'PHARMA',
    area: 'Queenstown',
    forecast: 'Partly cloudy',
    parking: park('NUH Car Park A', 103.7838, 1.2951, 0.2, 41),
    trafficRisk: 0.25,
  },
  {
    id: 'WHC',
    name: 'Woodlands Health Campus',
    short: 'Woodlands HC',
    address: '17 Woodlands Dr 17, 737628',
    lng: 103.7948,
    lat: 1.4246,
    windowStart: 570,
    windowEnd: 660,
    service: 15,
    cargo: 'PHARMA',
    area: 'Woodlands',
    forecast: 'Cloudy',
    parking: park('WHC Basement 2', 103.7956, 1.4239, 0.1, 55),
    trafficRisk: 0.45,
  },
  {
    id: 'AMK',
    name: 'AMK Hub FairPrice',
    short: 'AMK Hub',
    address: '53 Ang Mo Kio Ave 3, 569933',
    lng: 103.8484,
    lat: 1.3692,
    windowStart: 600,
    windowEnd: 750,
    service: 8,
    cargo: 'FROZEN',
    area: 'Ang Mo Kio',
    forecast: 'Partly cloudy',
    parking: park('AMK Hub B1 Loading', 103.8491, 1.3697, 0.1, 18),
    trafficRisk: 0.35,
  },
  {
    id: 'TAM',
    name: 'Tampines Mall Cold Store',
    short: 'Tampines',
    address: '4 Tampines Central 5, 529510',
    lng: 103.9447,
    lat: 1.3525,
    windowStart: 630,
    windowEnd: 780,
    service: 10,
    cargo: 'FROZEN',
    area: 'Tampines',
    forecast: 'Cloudy',
    parking: park('Tampines Mall Loading Bay', 103.9452, 1.3529, 0.05, 30),
    trafficRisk: 0.5,
  },
  {
    id: 'MBFC',
    name: 'MBFC Catering · Tower 3',
    short: 'MBFC',
    address: '12 Marina Blvd, 018982',
    lng: 103.854,
    lat: 1.2793,
    windowStart: 660,
    windowEnd: 750,
    service: 10,
    cargo: 'CHILLED',
    area: 'City',
    forecast: 'Heavy rain 10:30–11:15',
    parking: park('Marina Square MSCP', 103.8583, 1.2913, 1.1, 12),
    trafficRisk: 0.6,
  },
  {
    id: 'TPG',
    name: 'Tanjong Pagar Clinic',
    short: 'Tanjong Pagar',
    address: '7 Wallich St, 078884',
    lng: 103.8457,
    lat: 1.2765,
    windowStart: 600,
    windowEnd: 780,
    service: 6,
    cargo: 'PHARMA',
    area: 'City',
    forecast: 'Heavy rain 10:30–11:15',
    parking: park('Guoco Tower B2', 103.8462, 1.2769, 0.4, 22),
    trafficRisk: 0.5,
  },
  {
    id: 'HV',
    name: 'Holland V Bistro',
    short: 'Holland V',
    address: '118 Holland Ave, 278997',
    lng: 103.796,
    lat: 1.311,
    windowStart: 570,
    windowEnd: 840,
    service: 8,
    cargo: 'CHILLED',
    area: 'Bukit Timah',
    forecast: 'Partly cloudy',
    parking: park('Holland Village MSCP', 103.7951, 1.3119, 0.3, 26),
    trafficRisk: 0.3,
    review: { query: 'Holland V Bistro', candidates: ['118 Holland Ave, 278997', '211 Holland Ave, 278967'] },
  },
]

/** NEA 2-hour nowcast. The City cell is the one that changes the plan. */
export const RAIN: RainCell = {
  area: 'City',
  label: 'Heavy rain',
  start: 630,
  end: 675,
  center: [103.8515, 1.2862],
  radiusKm: 2.4,
  heavy: true,
}

/** A smaller, lighter cell. No stop or road of the run is inside it, so it never changes the plan. */
export const RAIN_LIGHT: RainCell = {
  area: 'Choa Chu Kang',
  label: 'Light rain',
  start: 615,
  end: 660,
  center: [103.7449, 1.384],
  radiusKm: 1.3,
  heavy: false,
}

export const RAIN_CELLS: RainCell[] = [RAIN, RAIN_LIGHT]

export const DEPARTURE = 540

export const PROFILES: Record<ProfileId, { label: string; hint: string; weights: Weights }> = {
  pharma: {
    label: 'Pharma',
    hint: 'Protect windows and cold-chain first',
    weights: { drive: 1, late: 6, weather: 4, parking: 0.6, cold: 0.8 },
  },
  balanced: {
    label: 'Balanced',
    hint: 'Trade a little time for lower risk',
    weights: { drive: 1, late: 4, weather: 2, parking: 0.4, cold: 0.4 },
  },
  fastest: {
    label: 'Fastest',
    hint: 'Shortest drive, windows as soft limits',
    weights: { drive: 1, late: 1, weather: 0, parking: 0, cold: 0 },
  },
}

export const CARGO_SENSITIVITY = { PHARMA: 1, FROZEN: 0.8, CHILLED: 0.6 } as const

/** Mock OneMap search results. Ids match scripts/fetch-osrm.mjs so legs follow real roads. */
export const ADDRESS_BOOK: Stop[] = [
  {
    id: 'BDK',
    name: 'Bedok Mall Cold Room',
    short: 'Bedok',
    address: '311 New Upper Changi Rd, 467360',
    lng: 103.9295,
    lat: 1.3248,
    windowStart: 660,
    windowEnd: 780,
    service: 8,
    cargo: 'FROZEN',
    area: 'Bedok',
    forecast: 'Cloudy',
    parking: park('Bedok Mall B2', 103.9301, 1.3252, 0.1, 34),
    trafficRisk: 0.4,
  },
  {
    id: 'KKH',
    name: 'KK Hospital Pharmacy',
    short: 'KK Hospital',
    address: '100 Bukit Timah Rd, 229899',
    lng: 103.8463,
    lat: 1.3105,
    windowStart: 600,
    windowEnd: 690,
    service: 10,
    cargo: 'PHARMA',
    area: 'Novena',
    forecast: 'Partly cloudy',
    parking: park('KKH Car Park', 103.8469, 1.3111, 0.2, 20),
    trafficRisk: 0.45,
  },
  {
    id: 'JWL',
    name: 'Jewel Changi Kitchen',
    short: 'Jewel',
    address: '78 Airport Blvd, 819666',
    lng: 103.9894,
    lat: 1.3602,
    windowStart: 690,
    windowEnd: 810,
    service: 12,
    cargo: 'CHILLED',
    area: 'Changi',
    forecast: 'Cloudy',
    parking: park('Jewel B3 Loading', 103.9889, 1.3598, 0.1, 44),
    trafficRisk: 0.3,
  },
]
