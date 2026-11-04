// Drive times and road lines for the cloud planner, from Amazon Location
// Service. They fill the same tables the console's optimiser reads
// (frontend/src/lib/roads.ts), so optimise() runs unchanged.
//
// Location Service is called in a region whose data comes from HERE
// (ROUTING_REGION, Sydney by default): in Singapore's own region the data is
// GrabMaps, which on 29 Oct 2026 could not route to or from NUH and takes no
// traffic options. Times are free-flowing; live or typical LTA traffic is
// applied on top, as in the console. A matrix is billed per pair, so pairs
// are cached by position in DynamoDB.
import { BatchGetItemCommand, BatchWriteItemCommand, type DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { CalculateRouteMatrixCommand, CalculateRoutesCommand, type GeoRoutesClient } from '@aws-sdk/client-geo-routes'
import { ensureLegs, ensureMatrix, legsOf, mergeLegs, round5, setDriveTimes, simplify, travel, type Point } from '../../frontend/src/lib/roads'
import type { DriveTime, RoadsUsed } from '../../frontend/src/lib/types'

export interface RoadClients {
  geo: Pick<GeoRoutesClient, 'send'>
  db: Pick<DynamoDBClient, 'send'>
  /** DynamoDB table of drive times by pair, key `pair` */
  table: string
}

// a pair's cached time lasts a month: roads change, but slowly
const TTL_SECONDS = 30 * 24 * 3600
// all of Singapore: a bounded matrix takes up to 500 origins in one call
const SINGAPORE: [number, number, number, number] = [103.55, 1.15, 104.15, 1.5]

const at = (p: Point) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`
const pairKey = (a: Point, b: Point) => `${at(a)}>${at(b)}`
const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size))

async function cachedTimes(points: Point[], c: RoadClients): Promise<DriveTime[]> {
  const byKey = new Map<string, [Point, Point]>()
  for (const a of points) for (const b of points) if (a.id !== b.id) byKey.set(pairKey(a, b), [a, b])
  // up to 100 keys a call; a pair left unread is measured again
  const replies = await Promise.all(
    chunks([...byKey.keys()], 100).map((keys) => c.db.send(new BatchGetItemCommand({ RequestItems: { [c.table]: { Keys: keys.map((pair) => ({ pair: { S: pair } })) } } }))),
  )
  return replies.flatMap((r) =>
    (r.Responses?.[c.table] ?? []).flatMap((item) => {
      const ab = byKey.get(item.pair?.S ?? '')
      return ab && item.minutes?.N && item.km?.N ? [{ from: ab[0].id, to: ab[1].id, minutes: Number(item.minutes.N), km: Number(item.km.N) }] : []
    }),
  )
}

interface Measured {
  times: DriveTime[]
  pairs: [Point, Point, number, number][]
  cells: number
}

async function measure(origins: Point[], destinations: Point[], c: RoadClients): Promise<Measured> {
  const r = await c.geo.send(
    new CalculateRouteMatrixCommand({
      Origins: origins.map((p) => ({ Position: [p.lng, p.lat] })),
      Destinations: destinations.map((p) => ({ Position: [p.lng, p.lat] })),
      RoutingBoundary: { Geometry: { BoundingBox: SINGAPORE } },
      TravelMode: 'Car',
      // free-flowing: LTA traffic is applied on top
      Traffic: { Usage: 'IgnoreTrafficData' },
    }),
  )
  const times: DriveTime[] = []
  const pairs: [Point, Point, number, number][] = []
  origins.forEach((a, i) =>
    destinations.forEach((b, j) => {
      const entry = r.RouteMatrix?.[i]?.[j]
      if (a.id === b.id || !entry || entry.Error || entry.Duration == null || entry.Distance == null) return
      const minutes = entry.Duration / 60
      const km = entry.Distance / 1000
      times.push({ from: a.id, to: b.id, minutes, km })
      pairs.push([a, b, minutes, km])
    }),
  )
  return { times, pairs, cells: origins.length * destinations.length }
}

async function remember(pairs: [Point, Point, number, number][], c: RoadClients, now: number) {
  const expires = String(Math.floor(now / 1000) + TTL_SECONDS)
  for (const batch of chunks(pairs, 25)) {
    await c.db.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [c.table]: batch.map(([a, b, minutes, km]) => ({
            PutRequest: { Item: { pair: { S: pairKey(a, b) }, minutes: { N: String(minutes) }, km: { N: String(km) }, expires: { N: expires } } },
          })),
        },
      }),
    )
  }
}

/**
 * The fewest points whose rows and columns cover every missing pair, chosen
 * greedily: one new stop among cached ones is just that stop, not the run.
 */
export function toMeasure(points: Point[], have: Set<string>): Point[] {
  const missing = new Set<string>()
  for (const a of points) for (const b of points) if (a.id !== b.id && !have.has(`${a.id}>${b.id}`)) missing.add(`${a.id}>${b.id}`)
  const chosen: Point[] = []
  while (missing.size) {
    const count = (p: Point) => [...missing].filter((k) => k.startsWith(`${p.id}>`) || k.endsWith(`>${p.id}`)).length
    const next = points.filter((p) => !chosen.includes(p)).reduce((best, p) => (count(p) > count(best) ? p : best))
    chosen.push(next)
    for (const k of [...missing]) if (k.startsWith(`${next.id}>`) || k.endsWith(`>${next.id}`)) missing.delete(k)
  }
  return chosen
}

/**
 * A drive time for every pair of points: cached pairs from DynamoDB, the rest
 * measured by Location Service in one matrix for the points they involve. If
 * Location Service fails, OSRM, as the console does; if that fails too, the
 * road-factor estimate.
 */
export async function ensureDriveTimes(points: Point[], c: RoadClients | null, now = Date.now()): Promise<RoadsUsed> {
  if (!c) return { source: (await ensureMatrix(points)) ? 'osrm' : 'estimate', cached: 0, measured: 0, billed: 0 }
  try {
    const cached = await cachedTimes(points, c)
    setDriveTimes(points, cached)
    const involved = toMeasure(points, new Set(cached.map((t) => `${t.from}>${t.to}`)))
    if (!involved.length) return { source: 'location', cached: cached.length, measured: 0, billed: 0 }
    // every pair touching a point with a missing pair: its row, and its column from the rest
    const rest = points.filter((p) => !involved.includes(p))
    const [rows, cols] = await Promise.all([measure(involved, points, c), rest.length ? measure(rest, involved, c) : null])
    const got = cols ? [rows, cols] : [rows]
    setDriveTimes(points, got.flatMap((m) => m.times))
    await remember(got.flatMap((m) => m.pairs), c, now)
    // pairs Location Service returned no route for: the optimiser estimates them
    const failed = points.reduce((n, a) => n + points.filter((b) => a.id !== b.id && !travel(a, b).real).length, 0)
    return {
      source: 'location',
      cached: cached.length,
      measured: got.reduce((n, m) => n + m.pairs.length, 0),
      billed: got.reduce((n, m) => n + m.cells, 0),
      ...(failed > 0 && { failed }),
    }
  } catch (e) {
    console.error('Location Service drive times failed; falling back to OSRM', e)
    return { source: (await ensureMatrix(points)) ? 'osrm' : 'estimate', cached: 0, measured: 0, billed: 0 }
  }
}

/**
 * Road lines for each path's legs (the plan and the shortest route): one
 * Location Service route per path, at the same time, or OSRM's if it fails.
 * Resolves to the routes Location Service bills for.
 */
export async function ensureRoadLines(paths: Point[][], c: RoadClients | null): Promise<number> {
  if (!c) {
    await ensureLegs(paths)
    return 0
  }
  // paths with a leg not drawn yet (by an earlier plan), each once: the two plans can be the same
  const missing = new Map(paths.filter((path) => path.length > 1 && Object.keys(legsOf(path)).length < path.length - 1).map((path) => [path.map((p) => p.id).join('>'), path]))
  const billed = await Promise.all([...missing.values()].map((path) => drawPath(path, c)))
  return billed.reduce((sum, n) => sum + n, 0)
}

async function drawPath(path: Point[], c: RoadClients): Promise<number> {
  let billed = 0
  try {
    const r = await c.geo.send(
      new CalculateRoutesCommand({
        Origin: [path[0].lng, path[0].lat],
        Destination: [path[path.length - 1].lng, path[path.length - 1].lat],
        Waypoints: path.slice(1, -1).map((p) => ({ Position: [p.lng, p.lat] })),
        TravelMode: 'Car',
        LegGeometryFormat: 'Simple',
        Traffic: { Usage: 'IgnoreTrafficData' },
      }),
    )
    billed++
    // one leg from each stop to the next; anything else (a ferry, say) cannot be split by stop
    const legs = r.Routes?.[0]?.Legs ?? []
    if (legs.length !== path.length - 1) throw new Error(`${legs.length} legs for ${path.length - 1} stops`)
    const lines: Record<string, [number, number][]> = {}
    legs.forEach((leg, i) => {
      const line = (leg.Geometry?.LineString ?? []) as [number, number][]
      if (line.length > 1) lines[`${path[i].id}>${path[i + 1].id}`] = simplify(line, 0.00012).map(([x, y]) => [round5(x), round5(y)])
    })
    mergeLegs(lines)
  } catch (e) {
    console.error('Location Service road lines failed; falling back to OSRM', e)
    await ensureLegs([path])
  }
  return billed
}
