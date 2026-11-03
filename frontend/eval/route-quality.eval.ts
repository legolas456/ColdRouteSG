// Route-quality evaluation: `npm run eval` (see eval/README.md).
//
// Plans every scenario four ways with the console's own code (src/lib/optimizer.ts):
// the exact shortest-drive route, earliest-deadline-first, ColdRoute Balanced and
// ColdRoute Pharma. Then checks the search against an exact branch-and-bound
// optimum, switches single cost terms off (ablation) and moves each weight by
// ±20% (sensitivity). Writes eval/results/{runs.csv,summary.json,summary.md}.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

import { CARGO_SENSITIVITY, DEPOT } from '../src/data/sample'
import { objectiveContribution, stopRawTerms } from '../src/lib/objective'
import { optimise, simulate } from '../src/lib/optimizer'
import { PROFILES } from '../src/lib/profiles'
import { setDriveTimes, travel } from '../src/lib/roads'
import type { Plan, RainCell, Stop, Weights } from '../src/lib/types'
import { buildPool, DEPARTURE, makeScenario, SEEDS, SIZES, TYPES, type Scenario } from './scenarios'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'pool-matrix.json')
const OUT = join(HERE, 'results')
/** Exact optimum check up to this many stops (branch and bound; 15 can take minutes). */
const EXACT_MAX = Number(process.env.EVAL_EXACT_MAX ?? 10)
/** Time limit per exact search; a search that hits it is reported as unfinished. */
const EXACT_BUDGET_MS = Number(process.env.EVAL_EXACT_MS ?? 60_000)

type Matrix = { source: string; fetched: string; ids: string[]; minutes: number[][]; km: number[][] }

async function loadMatrix(points: { id: string; lng: number; lat: number }[]): Promise<Matrix> {
  if (existsSync(FIXTURE)) {
    const m = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Matrix
    const missing = points.filter((p) => !m.ids.includes(p.id))
    if (!missing.length) return m
    throw new Error(`pool-matrix.json lacks ${missing.map((p) => p.id).join(', ')}; delete it to refetch`)
  }
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`)
  const body = await res.json()
  if (body.code !== 'Ok') throw new Error(`OSRM: ${body.message ?? body.code}`)
  const m: Matrix = {
    source: 'OSRM table service, router.project-osrm.org (OpenStreetMap data), free-flow driving',
    fetched: new Date().toISOString(),
    ids: points.map((p) => p.id),
    minutes: body.durations.map((row: number[]) => row.map((d) => Math.round((d / 60) * 10) / 10)),
    km: body.distances.map((row: number[]) => row.map((d) => Math.round((d / 1000) * 10) / 10)),
  }
  mkdirSync(dirname(FIXTURE), { recursive: true })
  writeFileSync(FIXTURE, JSON.stringify(m))
  return m
}

// ---------- metrics ----------

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

interface Metrics {
  late: number
  lateStops: number
  exposure: number
  rainMinutes: number
  rainStops: number
  drive: number
  km: number
  cost: number
}

function metrics(plan: Plan, sc: Scenario): Metrics {
  const byId = Object.fromEntries(sc.stops.map((s) => [s.id, s]))
  let rainMinutes = 0
  for (const row of plan.rows) {
    const s = byId[row.id]
    for (const c of sc.rain) if (c.area === s.area) rainMinutes += overlap(row.start, row.finish, c.start, c.end)
  }
  return {
    late: plan.lateMinutes,
    lateStops: plan.lateStops,
    exposure: plan.exposure,
    rainMinutes,
    rainStops: plan.rainStops,
    drive: plan.drive,
    km: plan.km,
    cost: plan.cost,
  }
}

const ctxFor = (sc: Scenario, weights: Weights) => ({
  depot: sc.depot,
  stops: Object.fromEntries(sc.stops.map((s) => [s.id, s])),
  departure: DEPARTURE,
  weights,
  rain: sc.rain,
  traffic: null,
})

/** Earliest deadline first: what a careful dispatcher does without a tool. */
const edfOrder = (stops: Stop[]) =>
  stops
    .slice()
    .sort((a, b) => a.windowEnd - b.windowEnd || a.windowStart - b.windowStart)
    .map((s) => s.id)

// ---------- exact optimum (branch and bound) ----------

/**
 * The exact minimum of the route cost, by depth-first search over orders.
 * Every cost term is non-negative, so a prefix's cost is a lower bound for any
 * route that starts with it, and a prefix that already costs more than the best
 * route found is cut. Mirrors simulate() without traffic; the winner is
 * re-scored with simulate() to check the two agree.
 */
function exactBest(sc: Scenario, weights: Weights, start: number[] | null, startCost: number) {
  const n = sc.stops.length
  const stops = sc.stops
  const deadline = performance.now() + EXACT_BUDGET_MS
  let best = startCost
  let bestOrder: number[] | null = start
  let nodes = 0
  let finished = true
  const order: number[] = []
  const used = new Array(n).fill(false)
  const cellsFor = stops.map((s) => sc.rain.filter((c: RainCell) => c.area === s.area))

  const step = (prev: { id: string; lng: number; lat: number }, t: number, cost: number) => {
    if (!finished) return
    if (order.length === n) {
      if (cost < best - 1e-9) {
        best = cost
        bestOrder = order.slice()
      }
      return
    }
    if ((++nodes & 0xffff) === 0 && performance.now() > deadline) {
      finished = false
      return
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue
      const s = stops[i]
      const minutes = travel(prev, s).minutes
      const arrive = t + minutes
      const begin = Math.max(arrive, s.windowStart)
      const late = Math.max(0, begin - s.windowEnd)
      const wet = cellsFor[i].filter((c) => begin < c.end && begin + s.service > c.start)
      const severity = wet.some((c) => c.heavy) ? 1 : wet.length ? 0.5 : 0
      const raw = stopRawTerms({
        driveMinutes: minutes,
        lateMinutes: late,
        serviceMinutes: s.service,
        rainSeverity: severity,
        parkingRisk: s.parking.risk,
        cargoSensitivity: CARGO_SENSITIVITY[s.cargo],
        onBoardMinutes: begin - DEPARTURE,
      })
      const c = objectiveContribution(raw, n, weights)
      const next = cost + c.drive + c.late + c.weather + c.parking + c.cold
      if (next >= best - 1e-9) continue
      used[i] = true
      order.push(i)
      step(s, begin + s.service, next)
      order.pop()
      used[i] = false
    }
  }
  step(sc.depot, DEPARTURE, 0)
  return { cost: best, order: bestOrder?.map((i) => stops[i].id) ?? null, nodes, finished }
}

// ---------- helpers ----------

const median = (xs: number[]) => {
  if (!xs.length) return NaN
  const a = xs.slice().sort((x, y) => x - y)
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const r1 = (x: number) => Math.round(x * 10) / 10
const pct = (x: number, base: number) => (base === 0 ? 0 : (100 * x) / base)
const renorm = (w: Weights): Weights => {
  const t = w.drive + w.late + w.weather + w.parking + w.cold
  return { drive: w.drive / t, late: w.late / t, weather: w.weather / t, parking: w.parking / t, cold: w.cold / t }
}
const KEYS = ['drive', 'late', 'weather', 'parking', 'cold'] as const
const PLANS = ['shortest', 'edf', 'balanced', 'pharma'] as const
type PlanName = (typeof PLANS)[number]

interface Run {
  sc: Scenario
  m: Record<PlanName, Metrics>
  order: Record<PlanName, string[]>
  ms: { balanced: number; pharma: number }
  evaluated: { balanced: number; pharma: number }
}

test('route-quality evaluation', { timeout: 60 * 60_000 }, async () => {
  const pool = buildPool()
  const depot = DEPOT
  const points = [depot, ...pool]
  const matrix = await loadMatrix(points)
  // every pair of the pool, as the planner would have measured it
  setDriveTimes(
    points,
    matrix.ids.flatMap((from, i) => matrix.ids.map((to, j) => ({ from, to, minutes: matrix.minutes[i][j], km: matrix.km[i][j] }))),
  )

  const runs: Run[] = []
  for (const type of TYPES)
    for (const size of SIZES)
      for (const seed of SEEDS) {
        const sc = makeScenario(pool, matrix, type, size, seed)
        const bal = optimise(sc.depot, sc.stops, DEPARTURE, PROFILES.balanced.weights, sc.rain, null)
        const pha = optimise(sc.depot, sc.stops, DEPARTURE, PROFILES.pharma.weights, sc.rain, null)
        expect(Math.abs(bal.baseline.drive - pha.baseline.drive)).toBeLessThan(1e-6)
        const edf = simulate(edfOrder(sc.stops), ctxFor(sc, PROFILES.balanced.weights))
        runs.push({
          sc,
          m: { shortest: metrics(bal.baseline, sc), edf: metrics(edf, sc), balanced: metrics(bal.recommended, sc), pharma: metrics(pha.recommended, sc) },
          order: { shortest: bal.baseline.order, edf: edf.order, balanced: bal.recommended.order, pharma: pha.recommended.order },
          ms: { balanced: bal.elapsedMs, pharma: pha.elapsedMs },
          evaluated: { balanced: bal.evaluated, pharma: pha.evaluated },
        })
      }
  expect(runs).toHaveLength(TYPES.length * SIZES.length * SEEDS.length)

  // ---------- per-run CSV ----------
  const header = ['scenario', 'type', 'size', 'seed', 'plan', 'late_min', 'late_stops', 'exposure', 'rain_unload_min', 'rain_stops', 'drive_min', 'km', 'extra_drive_pct', 'cost_balanced_or_own', 'order']
  const lines = [header.join(',')]
  for (const run of runs)
    for (const p of PLANS) {
      const m = run.m[p]
      lines.push(
        [run.sc.id, run.sc.type, run.sc.size, run.sc.seed, p, r1(m.late), m.lateStops, r1(m.exposure), r1(m.rainMinutes), m.rainStops, r1(m.drive), r1(m.km), r1(pct(m.drive - run.m.shortest.drive, run.m.shortest.drive)), Math.round(m.cost * 1e4) / 1e4, run.order[p].join(' ')].join(','),
      )
    }

  // ---------- summaries ----------
  const groups: Record<string, Run[]> = { all: runs, constrained: runs.filter((r) => r.sc.type !== 'easy') }
  for (const t of TYPES) groups[t] = runs.filter((r) => r.sc.type === t)
  const TIE = 0.5 // minutes
  const summary: Record<string, unknown> = {}
  for (const [g, rs] of Object.entries(groups)) {
    const base = rs.map((r) => r.m.shortest)
    const per: Record<string, unknown> = {}
    for (const p of PLANS) {
      const ms = rs.map((r) => r.m[p])
      const wtl = (k: 'late' | 'exposure' | 'rainMinutes') => {
        let win = 0
        let tie = 0
        let loss = 0
        rs.forEach((r) => {
          const d = r.m[p][k] - r.m.shortest[k]
          if (Math.abs(d) < TIE) tie++
          else if (d < 0) win++
          else loss++
        })
        return { win, tie, loss }
      }
      const extra = rs.map((r) => pct(r.m[p].drive - r.m.shortest.drive, r.m.shortest.drive))
      per[p] = {
        late_total: r1(sum(ms.map((m) => m.late))),
        late_stops_total: sum(ms.map((m) => m.lateStops)),
        late_median: r1(median(ms.map((m) => m.late))),
        late_worst: r1(Math.max(...ms.map((m) => m.late))),
        runs_with_late_stop: ms.filter((m) => m.lateStops > 0).length,
        exposure_total: r1(sum(ms.map((m) => m.exposure))),
        rain_unload_total: r1(sum(ms.map((m) => m.rainMinutes))),
        drive_total: r1(sum(ms.map((m) => m.drive))),
        extra_drive_pct_median: r1(median(extra)),
        extra_drive_pct_worst: r1(Math.max(...extra)),
        late_reduction_pct_vs_shortest: r1(pct(sum(base.map((m) => m.late)) - sum(ms.map((m) => m.late)), sum(base.map((m) => m.late)))),
        exposure_reduction_pct_vs_shortest: r1(pct(sum(base.map((m) => m.exposure)) - sum(ms.map((m) => m.exposure)), sum(base.map((m) => m.exposure)))),
        rain_reduction_pct_vs_shortest: r1(pct(sum(base.map((m) => m.rainMinutes)) - sum(ms.map((m) => m.rainMinutes)), sum(base.map((m) => m.rainMinutes)))),
        vs_shortest_late: wtl('late'),
        vs_shortest_exposure: wtl('exposure'),
        vs_shortest_rain: wtl('rainMinutes'),
      }
    }
    summary[g] = { runs: rs.length, plans: per }
  }

  // targets fixed before the run: on constrained scenarios, at least 20% fewer
  // late minutes and 10% less cargo exposure than the shortest route, for a
  // median of at most 15% more driving
  const targets: Record<string, unknown> = {}
  for (const p of ['balanced', 'pharma'] as const) {
    const c = (summary.constrained as { plans: Record<string, Record<string, number>> }).plans[p]
    targets[p] = {
      late_reduction_pct: c.late_reduction_pct_vs_shortest,
      late_met: c.late_reduction_pct_vs_shortest >= 20,
      exposure_reduction_pct: c.exposure_reduction_pct_vs_shortest,
      exposure_met: c.exposure_reduction_pct_vs_shortest >= 10,
      extra_drive_pct_median: c.extra_drive_pct_median,
      drive_met: c.extra_drive_pct_median <= 15,
    }
  }

  // ---------- planning time ----------
  const timing: Record<string, unknown> = {}
  for (const size of SIZES) {
    const rs = runs.filter((r) => r.sc.size === size)
    const ms = rs.flatMap((r) => [r.ms.balanced, r.ms.pharma])
    const ev = rs.flatMap((r) => [r.evaluated.balanced, r.evaluated.pharma])
    timing[size] = { plans: ms.length, ms_median: r1(median(ms)), ms_max: r1(Math.max(...ms)), orders_scored_median: median(ev), search: size <= 8 ? 'exhaustive' : 'local search from 4 starts' }
  }

  // ---------- exact optimum check ----------
  const exact: { scenario: string; profile: string; size: number; search_cost: number; exact_cost: number; gap_pct: number; finished: boolean; nodes: number }[] = []
  for (const run of runs) {
    if (run.sc.size > EXACT_MAX) continue
    for (const p of ['balanced', 'pharma'] as const) {
      const w = PROFILES[p].weights
      const cost = run.m[p].cost
      const e = exactBest(run.sc, w, null, cost + 1e-9)
      let exactCost = cost
      if (e.order) {
        const check = simulate(e.order, ctxFor(run.sc, w)).cost
        expect(Math.abs(check - e.cost)).toBeLessThan(1e-6)
        exactCost = e.cost
      }
      exact.push({ scenario: run.sc.id, profile: p, size: run.sc.size, search_cost: cost, exact_cost: exactCost, gap_pct: Math.round(pct(cost - exactCost, exactCost) * 100) / 100, finished: e.finished, nodes: e.nodes })
    }
  }
  const exactSummary: Record<string, unknown> = {}
  for (const size of SIZES) {
    const es = exact.filter((e) => e.size === size)
    if (!es.length) continue
    const done = es.filter((e) => e.finished)
    exactSummary[size] = {
      checked: es.length,
      finished: done.length,
      search_found_optimum: done.filter((e) => e.search_cost - e.exact_cost < 1e-9).length,
      worst_gap_pct: done.length ? Math.max(...done.map((e) => e.gap_pct)) : null,
      mean_gap_pct: done.length ? Math.round((sum(done.map((e) => e.gap_pct)) / done.length) * 1000) / 1000 : null,
    }
  }

  // ---------- ablation (Balanced, one term off, the rest renormalised) ----------
  const ablation: Record<string, unknown> = {}
  const constrained = groups.constrained
  for (const k of ['weather', 'cold', 'parking', 'late'] as const) {
    const w = renorm({ ...PROFILES.balanced.weights, [k]: 0 })
    let changed = 0
    const ms: Metrics[] = []
    for (const run of constrained) {
      const r = optimise(run.sc.depot, run.sc.stops, DEPARTURE, w, run.sc.rain, null).recommended
      if (r.order.join() !== run.order.balanced.join()) changed++
      ms.push(metrics(r, run.sc))
    }
    const full = constrained.map((r) => r.m.balanced)
    ablation[k] = {
      runs: constrained.length,
      order_changed: changed,
      late_total: r1(sum(ms.map((m) => m.late))),
      late_total_full: r1(sum(full.map((m) => m.late))),
      exposure_total: r1(sum(ms.map((m) => m.exposure))),
      exposure_total_full: r1(sum(full.map((m) => m.exposure))),
      rain_unload_total: r1(sum(ms.map((m) => m.rainMinutes))),
      rain_unload_total_full: r1(sum(full.map((m) => m.rainMinutes))),
      drive_total: r1(sum(ms.map((m) => m.drive))),
      drive_total_full: r1(sum(full.map((m) => m.drive))),
    }
  }

  // ---------- sensitivity (Balanced, each weight ±20%, renormalised) ----------
  const sensitivity: Record<string, unknown> = {}
  for (const k of KEYS)
    for (const f of [0.8, 1.2]) {
      const w = renorm({ ...PROFILES.balanced.weights, [k]: PROFILES.balanced.weights[k] * f })
      let changed = 0
      const ms: Metrics[] = []
      for (const run of runs) {
        const r = optimise(run.sc.depot, run.sc.stops, DEPARTURE, w, run.sc.rain, null).recommended
        if (r.order.join() !== run.order.balanced.join()) changed++
        ms.push(metrics(r, run.sc))
      }
      const full = runs.map((r) => r.m.balanced)
      sensitivity[`${k} x${f}`] = {
        runs: runs.length,
        order_changed: changed,
        late_change_min: r1(sum(ms.map((m) => m.late)) - sum(full.map((m) => m.late))),
        exposure_change_pct: r1(pct(sum(ms.map((m) => m.exposure)) - sum(full.map((m) => m.exposure)), sum(full.map((m) => m.exposure)))),
        drive_change_pct: r1(pct(sum(ms.map((m) => m.drive)) - sum(full.map((m) => m.drive)), sum(full.map((m) => m.drive)))),
      }
    }

  const out = {
    generated: new Date().toISOString(),
    setup: {
      scenarios: runs.length,
      types: TYPES,
      sizes: SIZES,
      seeds: SEEDS,
      departure: '09:00',
      depot: depot.name,
      pool_points: pool.length,
      drive_times: `${matrix.source}, fetched ${matrix.fetched.slice(0, 10)}`,
      traffic: 'none (free-flow OSRM times, factor 1)',
      weights: { balanced: PROFILES.balanced.weights, pharma: PROFILES.pharma.weights },
      tie_minutes: TIE,
      node: process.version,
    },
    summary,
    targets,
    timing,
    exact: exactSummary,
    ablation,
    sensitivity,
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'runs.csv'), lines.join('\n') + '\n')
  writeFileSync(join(OUT, 'exact-check.csv'), ['scenario,profile,size,search_cost,exact_cost,gap_pct,finished,nodes', ...exact.map((e) => [e.scenario, e.profile, e.size, e.search_cost.toFixed(6), e.exact_cost.toFixed(6), e.gap_pct, e.finished, e.nodes].join(','))].join('\n') + '\n')
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(out, null, 2) + '\n')
  writeFileSync(join(OUT, 'pool.csv'), ['id,name,area,lng,lat', ...pool.map((p) => [p.id, `"${p.name}"`, `"${p.area}"`, p.lng, p.lat].join(','))].join('\n') + '\n')
})
