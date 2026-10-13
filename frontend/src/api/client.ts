import type {
  LocationSuggestion,
  ParkingSummary,
  RouteRequest,
  RouteResponse,
  TrafficFeed,
  WeatherFeed,
} from '../types'
import { authenticatedFetch } from '../services/authFetch'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export interface RouteHistoryItem {
  user_id: string
  route_id: string
  created_at: string
  user_email?: string
  depot_name: string
  departure_time: string
  stop_count: number
  request: {
    depot?: { lat: number; lng: number }
    depot_name?: string
    departure_time?: string
    stops?: Array<{
      id: string
      name: string
      lat: number
      lng: number
      service_minutes: number
      cold_chain_priority: number
      window_end?: string | null
    }>
  }
  result: {
    route_id?: string | null
    generated_at?: string
    data_mode?: 'live' | 'mixed' | 'mock'
    total_distance_km?: number
    total_travel_minutes?: number
    total_service_minutes?: number
    total_lateness_minutes?: number
    composite_score?: number
    ordered_stop_ids?: string[]
    legs?: Array<{
      sequence: number
      stop_id: string
      stop_name: string
      eta: string
      travel_minutes: number
      distance_km: number
      service_minutes: number
      cold_chain_priority: number
      lateness_minutes: number
      weather?: { area?: string; forecast?: string; risk?: number; source?: string }
      parking?: {
        address?: string | null
        available_lots?: number | null
        total_lots?: number | null
        distance_m?: number | null
        source?: string
      }
      rationale?: string[]
    }>
    warnings?: string[]
  }
}


export interface AdminPerformanceSummary {
  total_drivers: number
  total_routes: number
  total_delivery_stops: number
  average_stops_per_route: number
  high_priority_deliveries: number
  total_planned_distance_km: number
  average_planned_travel_minutes: number
  total_planned_service_minutes: number
  total_planned_lateness_minutes: number
}

export interface AdminDriverPerformance {
  driver_id: string
  email: string
  routes: number
  stops: number
  high_priority_deliveries: number
  total_distance_km: number
  total_travel_minutes: number
  last_route_at?: string | null
  average_stops_per_route: number
  average_distance_km: number
  average_travel_minutes: number
}

export interface AdminRecentRoute {
  route_id?: string | null
  driver_id?: string | null
  email: string
  created_at?: string | null
  depot_name: string
  stop_count: number
  distance_km: number
  travel_minutes: number
}

export interface AdminPerformanceResponse {
  summary: AdminPerformanceSummary
  drivers: AdminDriverPerformance[]
  recent_routes: AdminRecentRoute[]
  metric_scope: string
}

export interface RouteHistoryResponse {
  routes: RouteHistoryItem[]
  count: number
}

/**
 * Calls the ColdRoute backend and parses a JSON response.
 *
 * By default, requests use authenticatedFetch() so the Cognito access token is
 * sent to API Gateway. Set requireAuth=false only for intentionally public
 * endpoints such as /api/health.
 */
async function requestJson<T>(
  path: string,
  init?: RequestInit,
  requireAuth = true,
): Promise<T> {
  const requestInit: RequestInit = {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  }

  const response = requireAuth
    ? await authenticatedFetch(`${API_BASE}${path}`, requestInit)
    : await fetch(`${API_BASE}${path}`, requestInit)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${response.status} ${response.statusText}: ${body}`)
  }

  return response.json() as Promise<T>
}


async function requestNoContent(path: string, init?: RequestInit): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}${path}`, init)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${response.status} ${response.statusText}: ${body}`)
  }
}

export const api = {
  // Keep health public so the backend can be checked without a Cognito session.
  health: () =>
    requestJson<{ status: string; mode: string; aws_connected: boolean }>(
      '/api/health',
      undefined,
      false,
    ),

  // All application endpoints below send the Cognito access token.
  searchLocations: (query: string) =>
    requestJson<{ source: string; warning?: string; results: LocationSuggestion[] }>(
      `/api/data/locations/search?q=${encodeURIComponent(query)}&limit=8`,
    ),

  weather: () => requestJson<WeatherFeed>('/api/data/weather'),

  parking: () => requestJson<ParkingSummary>('/api/data/parking'),

  trafficCameras: () =>
    requestJson<TrafficFeed>('/api/data/traffic-cameras?limit=8'),

  optimize: (payload: RouteRequest) =>
    requestJson<RouteResponse>('/api/routes/optimize', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  routeHistory: (limit = 50) =>
    requestJson<RouteHistoryResponse>(`/api/routes/history?limit=${limit}`),

  routeHistoryItem: (routeId: string) =>
    requestJson<RouteHistoryItem>(`/api/routes/history/${encodeURIComponent(routeId)}`),

  deleteRouteHistoryItem: (routeId: string) =>
    requestNoContent(`/api/routes/history/${encodeURIComponent(routeId)}`, {
      method: 'DELETE',
    }),

  adminPerformance: () =>
    requestJson<AdminPerformanceResponse>('/api/admin/performance'),

  adminDriverRoutes: (driverId: string, limit = 100) =>
    requestJson<RouteHistoryResponse>(
      `/api/admin/drivers/${encodeURIComponent(driverId)}/routes?limit=${limit}`,
    ),
}
