import { CARGO_SENSITIVITY, RAIN_CELLS } from '../data/sample'
import type { Depot, OptimiseResult, Plan, RainCell, Stop, StopResult, Weights } from './types'

import { legGeometry, travel, type Point } from './roads'
import { objectiveContribution, stopRawTerms } from './objective'

// drive times and road geometry live in roads.ts (snapshot + runtime OSRM)
export { legGeometry, travel }

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
}

export function simulate(order: string[], ctx: Context): Plan {
  const { depot, stops, departure, weights, rain } = ctx
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
    t += leg.minutes
    drive += leg.minutes
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
      driveMinutes: leg.minutes,
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
      T: s.trafficRisk,
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
      legMinutes: leg.minutes,
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

function twoOpt(order: string[], score: (o: string[]) => number) {
  let best = order.slice()
  let bestScore = score(best)
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const next = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)]
        const s = score(next)
        if (s < bestScore - 1e-6) {
          best = next
          bestScore = s
          improved = true
        }
      }
    }
  }
  return best
}

export function optimise(
  depot: Depot,
  stopList: Stop[],
  departure: number,
  weights: Weights,
  rain: RainCell[] = RAIN_CELLS,
): OptimiseResult {
  const t0 = performance.now()
  const stops = Object.fromEntries(stopList.map((s) => [s.id, s]))
  const ids = stopList.map((s) => s.id)
  const weightTotal = weights.drive + weights.late + weights.weather + weights.parking + weights.cold
  if (Object.values(weights).some((w) => !Number.isFinite(w) || w < 0) || Math.abs(weightTotal - 1) > 1e-9) {
    throw new Error('Route weights must be non-negative and sum to one')
  }
  const ctx: Context = { depot, stops, departure, weights, rain }
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
    const seed = ids.slice()
    const b = twoOpt(seed, (o) => (evaluated++, simulate(o, baseCtx).drive))
    const r = twoOpt(b, (o) => (evaluated++, simulate(o, ctx).cost))
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
  }
}
