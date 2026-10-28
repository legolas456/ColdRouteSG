// Fake AWS clients that answer like the real ones, for the planner's tests.
import { BatchGetItemCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb'
import { CalculateRouteMatrixCommand, CalculateRoutesCommand } from '@aws-sdk/client-geo-routes'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import type { RoadClients } from '../roads'

type Position = number[]

/** About 2 minutes per km on a straight line, and 3 more heading east (one-way streets), so a swapped pair shows. */
export const fakeMinutes = (a: Position, b: Position) => Math.hypot((b[0] - a[0]) * 111, (b[1] - a[1]) * 110) * 2 + (b[0] > a[0] ? 3 : 0)

/** DynamoDB holding cached pairs, and Location Service measuring the rest. */
export function fakeRoads(cache = new Map<string, { minutes: number; km: number }>(), geoFails = false) {
  const matrixCalls: { origins: Position[]; destinations: Position[] }[] = []
  const routeCalls: Position[][] = []
  const clients: RoadClients = {
    table: 'drive-times',
    db: {
      send: async (cmd: unknown) => {
        if (cmd instanceof BatchGetItemCommand) {
          const keys = cmd.input.RequestItems!['drive-times'].Keys!.map((k) => k.pair.S!)
          const items = keys.filter((k) => cache.has(k)).map((k) => ({ pair: { S: k }, minutes: { N: String(cache.get(k)!.minutes) }, km: { N: String(cache.get(k)!.km) } }))
          return { Responses: { 'drive-times': items } }
        }
        if (cmd instanceof BatchWriteItemCommand) {
          for (const w of cmd.input.RequestItems!['drive-times']) {
            const item = w.PutRequest!.Item!
            cache.set(item.pair.S!, { minutes: Number(item.minutes.N), km: Number(item.km.N) })
          }
          return {}
        }
        throw new Error('unexpected DynamoDB command')
      },
    } as RoadClients['db'],
    geo: {
      send: async (cmd: unknown) => {
        if (geoFails) throw new Error('AccessDeniedException')
        if (cmd instanceof CalculateRouteMatrixCommand) {
          const origins = cmd.input.Origins!.map((o) => o.Position!)
          const destinations = cmd.input.Destinations!.map((d) => d.Position!)
          matrixCalls.push({ origins, destinations })
          return { RouteMatrix: origins.map((o) => destinations.map((d) => ({ Duration: fakeMinutes(o, d) * 60, Distance: fakeMinutes(o, d) * 500 }))) }
        }
        if (cmd instanceof CalculateRoutesCommand) {
          const stops = [cmd.input.Origin!, ...(cmd.input.Waypoints ?? []).map((w) => w.Position!), cmd.input.Destination!]
          routeCalls.push(stops)
          // each leg as a line through its midpoint
          const legs = stops.slice(1).map((b, i) => {
            const a = stops[i]
            return { Geometry: { LineString: [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.01], b] } }
          })
          return { Routes: [{ Legs: legs }] }
        }
        throw new Error('unexpected Location Service command')
      },
    } as RoadClients['geo'],
  }
  return { clients, cache, matrixCalls, routeCalls }
}

/** An S3 bucket in memory. */
export function fakeBucket(objects: Record<string, unknown>) {
  return {
    send: async (cmd: unknown) => {
      if (!(cmd instanceof GetObjectCommand)) throw new Error('unexpected S3 command')
      const key = cmd.input.Key!
      if (!(key in objects)) throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' })
      return { Body: { transformToString: async () => JSON.stringify(objects[key]) } }
    },
  }
}
