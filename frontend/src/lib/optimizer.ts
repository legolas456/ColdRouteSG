import { CARGO_SENSITIVITY, RAIN_CELLS } from '../data/sample'
import type { Depot, OptimiseResult, Plan, RainCell, Stop, StopResult, Weights } from './types'

import { legGeometry, travel, type Point } from './roads'
import { objectiveContribution, stopRawTerms } from './objective'
import { legFactor, type TrafficGrid } from './traffic'

// drive times and road geometry live in roads.ts (snapshot + runtime OSRM)
export { legGeometry, travel }

// one optimisation asks for the same leg thousands of times
const factorCache = new WeakMap<TrafficGrid, Map<string, number>>()

/**
 * How many times longer than OSRM's free-flow time a leg takes in live traffic;
 * 1 without traffic data. Keyed by coordinates, since a stop id can be reused.
 */
export function trafficFactor(a: Point, b: Point, traffic?: TrafficGrid | null) {
  if (!traffic) return 1
  let cache = factorCache.get(traffic)
  if (!cache) factorCache.set(traffic, (cache = new Map()))
  const key = `${a.lng},${a.lat}>${b.lng},${b.lat}`
  let f = cache.get(key)
  if (f === undefined) cache.set(key, (f = legFactor(a, b, traffic)))
  return f
}

/** A delay this long on an approach is the full traffic risk for that stop. */
const FULL_TRAFFIC_RISK_MIN = 15

export function pathFor(depot: Depot, order: string[], stops: Record<string, Stop>) {
  const coords: [number, number][] = []
  let prev: Point = depot
  for (const id of order) {
    const next = stops[id]
    const leg = legGeometry(prev, next)
    coords.push(...(coords.length ? leg.slice(1) : leg))
    prev = next
  }
  return coords
}

interface Context {
  depot: Depot
  stops: Record<string, Stop>
  departure: number
  weights: Weights
  /** every rain cell in play; a stop is only affected by the one over its area */
  rain: RainCell[]
  /**
   * Live road speeds, applied to every leg. One reading stands for the whole
   * run, so drive times do not depend on the time of day.
   */
  traffic?: TrafficGrid | null
}

export function simulate(order: string[], ctx: Context): Plan {
  const { depot, stops, departure, weights, rain, traffic } = ctx
  let t = departure
  let prev: Point = depot
  let drive = 0
  let km = 0
  let lateMinutes = 0
  let lateStops = 0
  let exposure = 0
  let rainStops = 0
  let cost = 0
  const rows: StopResult[] = []

  order.forEach((id, i) => {
    const s = stops[id]
    const leg = travel(prev, s)
    const minutes = leg.minutes * trafficFactor(prev, s, traffic)
    t += minutes
    drive += minutes
    km += leg.km
    const arrival = t
    const start = Math.max(t, s.windowStart)
    const late = Math.max(0, start - s.windowEnd)
    const slack = s.windowEnd - start
    const cells = rain.filter((c) => c.area === s.area)
    const overlappingRain = cells.filter((c) => start < c.end && start + s.service > c.start)
    const inRain = overlappingRain.length > 0
    const rainSeverity = overlappingRain.some((c) => c.heavy) ? 1 : inRain ? 0.5 : 0
    const park = s.parking.risk
    const sens = CARGO_SENSITIVITY[s.cargo]
    const raw = stopRawTerms({
      driveMinutes: minutes,
      lateMinutes: late,
      serviceMinutes: s.service,
      rainSeverity,
      parkingRisk: park,
      cargoSensitivity: sens,
      onBoardMinutes: start - departure,
    })
    const c = objectiveContribution(raw, order.length, weights)

    const nearRain = cells.some((c) => Math.abs(start - c.end) < 30)
    const risk = {
      W: inRain ? rainSeverity : nearRain ? 0.35 : 0.1,
      P: park,
      T: Math.min(1, (minutes - leg.minutes) / FULL_TRAFFIC_RISK_MIN),
      C: Math.min(1, (sens * (start - departure)) / 200),
      L: late > 0 ? 1 : slack < 15 ? 0.6 : slack < 30 ? 0.3 : 0,
    }
    const riskScore = 0.25 * risk.W + 0.25 * risk.P + 0.15 * risk.T + 0.15 * risk.C + 0.2 * risk.L

    lateMinutes += late
    lateStops += late > 0 ? 1 : 0
    exposure += raw.cold
    rainStops += inRain ? 1 : 0
    cost += c.drive + c.late + c.weather + c.parking + c.cold

    rows.push({
      id,
      seq: i + 1,
      legMinutes: minutes,
      trafficMinutes: minutes - leg.minutes,
      legKm: leg.km,
      arrival,
      start,
      finish: start + s.service,
      wait: start - arrival,
      late,
      slack,
      inRain,
      exposure: raw.cold,
      risk,
      riskScore,
      cost: c,
    })
    t = start + s.service
    prev = s
  })

  return {
    order,
    rows,
    byId: Object.fromEntries(rows.map((r) => [r.id, r])),
    drive,
    km,
    lateMinutes,
    lateStops,
    exposure,
    rainStops,
    cost,
    end: t,
  }
}

function* permutations(items: string[]): Generator<string[]> {
  const a = items.slice()
  const c = new Array(a.length).fill(0)
  yield a.slice()
  let i = 0
  while (i < a.length) {
    if (c[i] < i) {
      const j = i % 2 ? c[i] : 0
      ;[a[i], a[j]] = [a[j], a[i]]
      yield a.slice()
      c[i]++
      i = 0
    } else {
      c[i] = 0
      i++
    }
  }
}

/**
 * Local search for runs too long to enumerate. 2-opt reverses a stretch of the
 * route, Or-opt moves a run of one to three stops elsewhere, and a swap exchanges
 * two stops. 2-opt alone does badly with time windows, because a reversal makes
 * every stop in the stretch earlier or later at once.
 */
function localSearch(start: string[], score: (o: string[]) => number) {
  let best = start.slice()
  let bestScore = score(best)
  const tryOrder = (next: string[]) => {
    const s = score(next)
    if (s >= bestScore - 1e-6) return false
    best = next
    bestScore = s
    return true
  }
  let improved = true
  while (improved) {
    improved = false
    for (let len = 1; len <= 3; len++) {
      for (let i = 0; i + len <= best.length; i++) {
        for (let k = 0; k <= best.length - len; k++) {
          if (k === i) continue
          const rest = [...best.slice(0, i), ...best.slice(i + len)]
          if (tryOrder([...rest.slice(0, k), ...best.slice(i, i + len), ...rest.slice(k)])) improved = true
        }
      }
    }
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        if (tryOrder([...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)])) improved = true
      }
    }
    // Neighbouring stops are already swapped by the moves above.
    for (let i = 0; i < best.length - 2; i++) {
      for (let k = i + 2; k < best.length; k++) {
        const next = best.slice()
        ;[next[i], next[k]] = [next[k], next[i]]
        if (tryOrder(next)) improved = true
      }
    }
  }
  return { order: best, score: bestScore }
}

/** The best local optimum over several starting orders; the earlier start wins a tie. */
function bestOf(starts: string[][], score: (o: string[]) => number) {
  return starts.map((s) => localSearch(s, score)).reduce((a, b) => (b.score < a.score ? b : a)).order
}

/** Covers MAX_STOPS in places.ts; 2^15 subsets × 15 end stops is about 0.5 M states. */
const EXACT_DRIVE_STOPS = 15

/** A leg's drive time as simulate() counts it, so the searches agree with the plan. */
const driveMinutes = (a: Point, b: Point, traffic?: TrafficGrid | null) => travel(a, b).minutes * trafficFactor(a, b, traffic)

/**
 * The exact shortest-drive order (Held–Karp). Drive time does not depend on the
 * time of day (one traffic reading covers the run), so unlike the full cost it
 * can be solved exactly over subsets of stops. This keeps the shortest-route
 * comparison honest above eight stops.
 */
function shortestDriveOrder(depot: Depot, stopList: Stop[], traffic?: TrafficGrid | null) {
  const n = stopList.length
  const full = (1 << n) - 1
  const legs = stopList.map((a) => stopList.map((b) => driveMinutes(a, b, traffic)))
  const best = new Float64Array((full + 1) * n).fill(Infinity)
  const from = new Int8Array((full + 1) * n).fill(-1)
  stopList.forEach((s, j) => (best[(1 << j) * n + j] = driveMinutes(depot, s, traffic)))
  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < n; j++) {
      const here = best[mask * n + j]
      if (!(mask & (1 << j)) || here === Infinity) continue
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue
        const at = (mask | (1 << k)) * n + k
        if (here + legs[j][k] < best[at]) {
          best[at] = here + legs[j][k]
          from[at] = j
        }
      }
    }
  }
  let last = 0
  for (let j = 1; j < n; j++) if (best[full * n + j] < best[full * n + last]) last = j
  const order: string[] = []
  for (let mask = full, j = last; j !== -1; ) {
    order.push(stopList[j].id)
    const prev = from[mask * n + j]
    mask &= ~(1 << j)
    j = prev
  }
  return order.reverse()
}

/** Starting orders besides the entered one: earliest deadline first, and nearest stop next. */
function startingOrders(depot: Depot, stopList: Stop[], traffic?: TrafficGrid | null) {
  const byDeadline = stopList
    .slice()
    .sort((a, b) => a.windowEnd - b.windowEnd || a.windowStart - b.windowStart)
    .map((s) => s.id)
  const nearest: string[] = []
  const left = stopList.slice()
  let at: Point = depot
  while (left.length) {
    let next = 0
    for (let i = 1; i < left.length; i++) {
      if (driveMinutes(at, left[i], traffic) < driveMinutes(at, left[next], traffic)) next = i
    }
    at = left[next]
    nearest.push(left[next].id)
    left.splice(next, 1)
  }
  return { byDeadline, nearest }
}

export function optimise(
  depot: Depot,
  stopList: Stop[],
  departure: number,
  weights: Weights,
  rain: RainCell[] = RAIN_CELLS,
  /** live road speeds; leave out to plan with OSRM's free-flow drive times */
  traffic: TrafficGrid | null = null,
): OptimiseResult {
  const t0 = performance.now()
  const stops = Object.fromEntries(stopList.map((s) => [s.id, s]))
  const ids = stopList.map((s) => s.id)
  const weightTotal = weights.drive + weights.late + weights.weather + weights.parking + weights.cold
  if (Object.values(weights).some((w) => !Number.isFinite(w) || w < 0) || Math.abs(weightTotal - 1) > 1e-9) {
    throw new Error('Route weights must be non-negative and sum to one')
  }
  const ctx: Context = { depot, stops, departure, weights, rain, traffic }
  const baseCtx: Context = { ...ctx, weights: { drive: 1, late: 0, weather: 0, parking: 0, cold: 0 } }

  let baseline: Plan | null = null
  let recommended: Plan | null = null
  let evaluated = 0

  if (ids.length <= 8) {
    for (const order of permutations(ids)) {
      evaluated++
      const plan = simulate(order, ctx)
      if (!recommended || plan.cost < recommended.cost) recommended = plan
      if (!baseline || plan.drive < baseline.drive) baseline = plan
    }
  } else {
    // 9 stops already have 362,880 orders, so search locally from several starts.
    // src/lib/__tests__/optimizer.search.test.ts checks fixed 9-stop runs against
    // exhaustive search.
    const { byDeadline, nearest } = startingOrders(depot, stopList, traffic)
    const b =
      ids.length <= EXACT_DRIVE_STOPS
        ? shortestDriveOrder(depot, stopList, traffic)
        : bestOf([ids, nearest], (o) => (evaluated++, simulate(o, baseCtx).drive))
    // Starting from the baseline too means the plan never scores worse than it.
    const r = bestOf([b, ids, byDeadline, nearest], (o) => (evaluated++, simulate(o, ctx).cost))
    baseline = simulate(b, ctx)
    recommended = simulate(r, ctx)
  }

  const rec = recommended ?? simulate(ids, ctx)
  const highestRiskId = rec.rows.reduce((a, b) => (b.riskScore > a.riskScore ? b : a), rec.rows[0])?.id ?? ''

  return {
    baseline: baseline ?? rec,
    recommended: rec,
    evaluated,
    elapsedMs: performance.now() - t0,
    highestRiskId,
    trafficAt: traffic ? traffic.at : null,
  }
}
