import osrm from '../data/osrm.json'
import { CARGO_SENSITIVITY, RAIN_CELLS } from '../data/sample'
import type { Depot, OptimiseResult, Plan, RainCell, Stop, StopResult, Weights } from './types'

type Point = { id: string; lng: number; lat: number }

const matrix = osrm as unknown as {
  minutes: Record<string, Record<string, number>>
  km: Record<string, Record<string, number>>
  legs: Record<string, [number, number][]>
}

const haversineKm = (a: Point, b: Point) => {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Real OSRM values for the sample network, a road-factor estimate otherwise. */
export function travel(a: Point, b: Point) {
  const minutes = matrix.minutes[a.id]?.[b.id]
  const km = matrix.km[a.id]?.[b.id]
  if (minutes !== undefined && km !== undefined) return { minutes, km }
  const crow = haversineKm(a, b)
  return { km: crow * 1.35, minutes: ((crow * 1.35) / 38) * 60 + 4 }
}

export function legGeometry(a: Point, b: Point): [number, number][] {
  return matrix.legs[`${a.id}>${b.id}`] ?? [
    [a.lng, a.lat],
    [b.lng, b.lat],
  ]
}

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
    const inRain = cells.some((c) => start < c.end && start + s.service > c.start)
    const park = s.parking.risk
    const sens = CARGO_SENSITIVITY[s.cargo]
    const unload = s.service * (1 + 1.5 * park) * (inRain ? 1.4 : 1)
    const onBoard = (start - departure) / 60

    const c = {
      weather: (inRain ? s.service * (1 + park) : 0) * weights.weather,
      parking: park * s.service * weights.parking,
      traffic: leg.minutes * (1 + s.trafficRisk * 0.3) * weights.drive,
      cold: (sens * onBoard * 10 + sens * unload * 0.5) * weights.cold,
      lateness: late * weights.late,
    }

    const nearRain = cells.some((c) => Math.abs(start - c.end) < 30)
    const risk = {
      W: inRain ? 0.9 : nearRain ? 0.35 : 0.1,
      P: park,
      T: s.trafficRisk,
      C: Math.min(1, (sens * (start - departure)) / 200),
      L: late > 0 ? 1 : slack < 15 ? 0.6 : slack < 30 ? 0.3 : 0,
    }
    const riskScore = 0.25 * risk.W + 0.25 * risk.P + 0.15 * risk.T + 0.15 * risk.C + 0.2 * risk.L

    lateMinutes += late
    lateStops += late > 0 ? 1 : 0
    exposure += unload
    rainStops += inRain ? 1 : 0
    cost += c.weather + c.parking + c.traffic + c.cold + c.lateness

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
      exposure: unload,
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
