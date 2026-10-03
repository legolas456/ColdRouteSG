export interface Coordinate {
  lat: number
  lng: number
}

export interface LocationSuggestion extends Coordinate {
  name: string
  label: string
}

export interface DeliveryStop extends Coordinate {
  id: string
  name: string
  service_minutes: number
  cold_chain_priority: 1 | 2 | 3
  window_end?: string | null
}

export interface RouteRequest {
  depot: Coordinate
  depot_name: string
  departure_time: string
  stops: DeliveryStop[]
}

export interface WeatherContext {
  area: string
  forecast: string
  risk: number
  source: 'live' | 'mock'
}

export interface ParkingContext {
  carpark_no?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
  distance_m?: number | null
  available_lots?: number | null
  total_lots?: number | null
  occupancy_ratio?: number | null
  risk: number
  source: 'live' | 'mock'
}

export interface RouteLeg {
  sequence: number
  stop_id: string
  stop_name: string
  eta: string
  travel_minutes: number
  distance_km: number
  service_minutes: number
  weather: WeatherContext
  parking: ParkingContext
  cold_chain_priority: 1 | 2 | 3
  lateness_minutes: number
  incremental_score: number
  rationale: string[]
}

export interface RouteResponse {
  generated_at: string
  data_mode: 'live' | 'mixed' | 'mock'
  total_distance_km: number
  total_travel_minutes: number
  total_service_minutes: number
  total_lateness_minutes: number
  composite_score: number
  ordered_stop_ids: string[]
  legs: RouteLeg[]
  route_geometry: [number, number][]
  warnings: string[]
}

export interface WeatherFeed {
  source: 'live' | 'mock'
  timestamp?: string
  warning?: string
  areas: Array<{
    area: string
    forecast: string
    lat?: number
    lng?: number
    risk: number
  }>
}

export interface ParkingSummary {
  source: 'live' | 'mock'
  timestamp?: string
  total_carparks: number
  total_lots: number
  available_lots: number
  availability_ratio?: number | null
  warning?: string
}

export interface TrafficCamera {
  camera_id?: string
  lat?: number
  lng?: number
  image?: string | null
  timestamp?: string
}

export interface TrafficFeed {
  source: 'live' | 'mock'
  timestamp?: string
  warning?: string
  cameras: TrafficCamera[]
}
