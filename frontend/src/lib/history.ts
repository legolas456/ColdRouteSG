import { DEPOT, SAMPLE_STOPS } from '../data/sample'
import { API_URL, api } from './api'
import { AUTH_ENABLED } from './auth'
import { depotFromPlace } from './depot'
import { stopFromPlace } from './places'
import { hm, parseHm } from './time'
import type { Depot, OptimiseResult, Plan, ProfileId, Stop } from './types'

/**
 * Saved runs: each plan a signed-in user makes is stored in their route history
 * (DynamoDB, through the API in infra/), so they can reopen it later and an
 * admin sees the team's activity. The plan itself is made by the console, in
 * the browser or by the cloud planner (planner.ts).
 */
export const HISTORY_ENABLED = Boolean(API_URL) && AUTH_ENABLED

interface PlanTotals {
  order: string[]
  total_distance_km: number
  total_travel_minutes: number
  total_service_minutes: number
  total_lateness_minutes: number
  late_stops: number
  exposure_minutes: number
  rain_stops: number
}

export interface SavedStop {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  window_start: string
  window_end: string
  service_minutes: number
  cargo: Stop['cargo']
}

/** What POST /api/routes/history takes (backend/app/models.py PlannedRun). */
export interface PlannedRun {
  depot: { lat: number; lng: number }
  depot_name: string
  depot_address: string
  departure_time: string
  profile: ProfileId
  data_mode: 'live' | 'recorded'
  stops: SavedStop[]
  plan: PlanTotals
  shortest: PlanTotals
}

/** A run as GET /api/routes/history returns it. */
export interface SavedRun {
  route_id: string
  created_at: string
  depot_name: string
  departure_time: string
  stop_count: number
  request: Omit<PlannedRun, 'plan' | 'shortest'>
  result: PlanTotals & { source?: string; shortest?: PlanTotals }
}

const totals = (plan: Plan, service: number): PlanTotals => ({
  order: plan.order,
  total_distance_km: round(plan.km, 2),
  total_travel_minutes: round(plan.drive, 1),
  total_service_minutes: service,
  total_lateness_minutes: round(plan.lateMinutes, 1),
  late_stops: plan.lateStops,
  exposure_minutes: round(plan.exposure, 1),
  rain_stops: plan.rainStops,
})

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits

/** The run to save, from what the plan was made with. */
export function plannedRun(input: {
  depot: Depot
  stops: Stop[]
  departure: number
  profile: ProfileId
  dataMode: 'live' | 'recorded'
  result: OptimiseResult
}): PlannedRun {
  const { depot, stops, departure, profile, dataMode, result } = input
  const service = stops.reduce((sum, s) => sum + s.service, 0)
  return {
    depot: { lat: depot.lat, lng: depot.lng },
    depot_name: depot.name.slice(0, 120),
    depot_address: depot.address.slice(0, 200),
    departure_time: hm(departure),
    profile,
    data_mode: dataMode,
    stops: stops.map((s) => ({
      id: s.id,
      name: s.name.slice(0, 120),
      address: s.address.slice(0, 200),
      lat: s.lat,
      lng: s.lng,
      window_start: hm(s.windowStart),
      window_end: hm(s.windowEnd),
      service_minutes: s.service,
      cargo: s.cargo,
    })),
    plan: totals(result.recommended, service),
    shortest: totals(result.baseline, service),
  }
}

export const LEGACY_RUN = 'This run was saved by the older planner, so it can only be listed here, not reopened'

/**
 * Only runs saved by this console can be reopened: plans from the older
 * /api/routes/optimize endpoint share the table but have no windows, cargo or
 * profile.
 */
export function canReopen(saved: SavedRun): boolean {
  const r = saved.request as Partial<SavedRun['request']> | undefined
  return Boolean(
    r?.departure_time &&
      r.profile &&
      r.depot &&
      Array.isArray(r.stops) &&
      r.stops.every((s) => s.window_start && s.window_end && s.cargo && typeof s.service_minutes === 'number'),
  )
}

/** What "Make a copy" says: a copy is a draft until it is optimised. */
export const copyToast = (savesOnOptimise: boolean) =>
  savesOnOptimise
    ? 'Copy made · it is saved to your runs when you optimise it'
    : 'Copy made · you can edit it now'

/**
 * A saved run back as the console's own depot and stops. The sample's stops keep
 * their recorded details; any other stop gets its forecast area and nearest
 * carpark again, as when it was first added.
 */
export async function reopenRun(saved: SavedRun): Promise<{ depot: Depot; stops: Stop[]; departure: number; profile: ProfileId }> {
  if (!canReopen(saved)) throw new Error(LEGACY_RUN)
  const r = saved.request
  const departure = parseHm(r.departure_time)
  const sameSpot = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6
  const depot = sameSpot(r.depot, DEPOT)
    ? DEPOT
    : depotFromPlace({ key: 'saved-depot', name: r.depot_name, address: r.depot_address, postal: '', lat: r.depot.lat, lng: r.depot.lng })
  const stops = await Promise.all(
    r.stops.map(async (s) => {
      const sample = SAMPLE_STOPS.find((x) => x.id === s.id && sameSpot(x, s))
      const base = sample ?? (await stopFromPlace({ key: s.id, name: s.name, address: s.address, postal: '', lat: s.lat, lng: s.lng }, departure, []))
      return { ...base, id: s.id, windowStart: parseHm(s.window_start), windowEnd: parseHm(s.window_end), service: s.service_minutes, cargo: s.cargo }
    }),
  )
  return { depot, stops, departure, profile: r.profile }
}

export const saveRun = (run: PlannedRun) =>
  api<{ route_id: string }>('/api/routes/history', { method: 'POST', body: JSON.stringify(run) }).then((r) => r.route_id)

/** A page of the user's runs, newest first, and the `after` for the next page (null on the last). */
export const listRuns = (limit = 20, after?: string) =>
  api<{ routes: SavedRun[]; next?: string | null }>(`/api/routes/history?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ''}`).then(
    (r) => ({ runs: r.routes, next: r.next ?? null }),
  )

export const deleteRun = (routeId: string) => api<void>(`/api/routes/history/${encodeURIComponent(routeId)}`, { method: 'DELETE' })

export interface TeamActivity {
  summary: {
    total_drivers: number
    total_routes: number
    total_delivery_stops: number
    high_priority_deliveries: number
    total_planned_distance_km: number
    average_planned_travel_minutes: number
    total_planned_lateness_minutes: number
  }
  drivers: { driver_id: string; email: string; routes: number; stops: number; average_travel_minutes: number; last_route_at: string | null }[]
  recent_routes: { route_id: string; email: string; created_at: string; depot_name: string; stop_count: number; travel_minutes: number }[]
}

export const teamActivity = () => api<TeamActivity>('/api/admin/performance')
