// One run planned in the cloud, with the console's own code from conditions to
// optimise(): only where the inputs come from differs (inputs.ts, roads.ts).
import { liveConditions, type TypicalTraffic, wantsTypical } from '../../frontend/src/lib/conditions'
import { type Json, sgMinutes } from '../../frontend/src/lib/feeds'
import { optimise } from '../../frontend/src/lib/optimizer'
import { PROFILES } from '../../frontend/src/lib/profiles'
import { legsOf, type Point, travel } from '../../frontend/src/lib/roads'
import type { DriveTime, PlanResponse, RoadsUsed } from '../../frontend/src/lib/types'
import type { Inputs } from './inputs'
import type { PlanRequest } from './request'
import { ensureDriveTimes, ensureRoadLines, type RoadClients } from './roads'

export interface PlanDeps {
  inputs: () => Promise<Inputs>
  typical: (departure: number) => Promise<TypicalTraffic & { raw: Json | null }>
  roads: RoadClients | null
  now?: () => number
}

const ROADS_NOTE: Record<RoadsUsed['source'], string | null> = {
  location: null,
  osrm: 'Amazon Location Service did not answer, so drive times come from OSRM.',
  estimate: 'Neither Amazon Location Service nor OSRM answered, so drive times are estimated from straight-line distance.',
}

export async function plan(req: PlanRequest, deps: PlanDeps): Promise<PlanResponse> {
  const started = Date.now()
  const now = deps.now?.() ?? started
  // drive times depend only on where the stops are, so they are measured while the conditions are read
  const points: Point[] = [req.depot, ...req.stops]
  const [{ feeds, rawTraffic }, roads] = await Promise.all([deps.inputs(), ensureDriveTimes(points, deps.roads, now)])
  const minutesNow = sgMinutes(now)
  // as in the console: a live reading if one stands for the departure, else the slot's typical traffic
  const typical = wantsTypical(feeds.traffic, minutesNow, req.departure) ? await deps.typical(req.departure) : undefined
  const cond = liveConditions(req.stops, feeds, minutesNow, req.departure, typical)

  const result = optimise(req.depot, cond.stops, req.departure, PROFILES[req.profile].weights, cond.rain, cond.traffic)

  const byId = Object.fromEntries(cond.stops.map((s) => [s.id, s]))
  const paths: Point[][] = [result.recommended.order, result.baseline.order].map((order) => [req.depot, ...order.map((id) => byId[id])])
  roads.billed += await ensureRoadLines(paths, deps.roads)

  const failed = roads.failed
    ? `Amazon Location Service could not route ${roads.failed} pair${roads.failed === 1 ? '' : 's'} of stops, so ${roads.failed === 1 ? 'it is' : 'they are'} estimated from straight-line distance.`
    : null
  const note = ROADS_NOTE[roads.source] ?? failed
  const traffic = cond.traffic === null ? null : cond.traffic === feeds.traffic.data ? rawTraffic : (typical?.raw ?? null)
  // measured times only: the console keeps estimating the rest itself
  const times: DriveTime[] = points.flatMap((a) =>
    points.flatMap((b) => {
      const t = a.id === b.id ? null : travel(a, b)
      return t?.real ? [{ from: a.id, to: b.id, minutes: t.minutes, km: t.km }] : []
    }),
  )
  return {
    result,
    conditions: { ...cond, notes: note ? [...cond.notes, note] : cond.notes, traffic },
    legs: Object.assign({}, ...paths.map(legsOf)),
    times,
    roads,
    elapsedMs: Date.now() - started,
  }
}
