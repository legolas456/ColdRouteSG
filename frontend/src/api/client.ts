import type {
  LocationSuggestion,
  ParkingSummary,
  RouteRequest,
  RouteResponse,
  TrafficFeed,
  WeatherFeed,
} from '../types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${response.status} ${response.statusText}: ${body}`)
  }
  return response.json() as Promise<T>
}

export const api = {
  health: () => requestJson<{ status: string; mode: string; aws_connected: boolean }>('/api/health'),
  searchLocations: (query: string) =>
    requestJson<{ source: string; warning?: string; results: LocationSuggestion[] }>(
      `/api/data/locations/search?q=${encodeURIComponent(query)}&limit=8`,
    ),
  weather: () => requestJson<WeatherFeed>('/api/data/weather'),
  parking: () => requestJson<ParkingSummary>('/api/data/parking'),
  trafficCameras: () => requestJson<TrafficFeed>('/api/data/traffic-cameras?limit=8'),
  optimize: (payload: RouteRequest) =>
    requestJson<RouteResponse>('/api/routes/optimize', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}
