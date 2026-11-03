// What the console sends (POST /api/plan), checked before anything is spent on
// it: Location Service bills every pair of stops. Only the fields a run has are
// kept; anything else in the body is dropped.
import { PROFILES } from '../../frontend/src/lib/profiles'
import type { Carpark, Cargo, Depot, ProfileId, Stop } from '../../frontend/src/lib/types'

export interface PlanRequest {
  depot: Depot
  stops: Stop[]
  /** minutes after midnight, Singapore time */
  departure: number
  profile: ProfileId
}

/** One van, one run: MAX_STOPS in the console (frontend/src/lib/places.ts) */
export const MAX_STOPS = 15
const CARGO: Cargo[] = ['PHARMA', 'FROZEN', 'CHILLED']

class BadRequest extends Error {}
const fail = (what: string): never => {
  throw new BadRequest(what)
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, what: string, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(`${what} must be a number from ${min} to ${max}.`)
const text = (v: unknown, what: string, max = 200) => (typeof v === 'string' && v.length <= max ? v : fail(`${what} must be text of up to ${max} characters.`))

function place(v: Json, what: string) {
  return { lat: num(v.lat, `${what} latitude`, 1.15, 1.5), lng: num(v.lng, `${what} longitude`, 103.55, 104.15) }
}

function parking(v: unknown, what: string): Carpark {
  if (!isObject(v)) return fail(`${what} needs its parking.`)
  const p: Carpark = {
    name: text(v.name, `${what} parking name`),
    ...place(v, `${what} parking`),
    distanceKm: num(v.distanceKm, `${what} parking distance`, 0, 50),
    freePct: num(v.freePct, `${what} parking free share`, 0, 100),
    risk: num(v.risk, `${what} parking risk`, 0, 1),
  }
  if (v.code !== undefined) p.code = text(v.code, `${what} parking code`, 20)
  if (v.agency !== undefined) p.agency = v.agency === 'URA' || v.agency === 'LTA' ? v.agency : fail(`${what} parking agency must be URA or LTA.`)
  if (v.estimated !== undefined) p.estimated = v.estimated === true
  if (v.live !== undefined) {
    if (!isObject(v.live)) return fail(`${what} parking lots must be an object.`)
    p.live = { free: num(v.live.free, `${what} free lots`, 0, 100_000) }
    if (v.live.total !== undefined) p.live.total = num(v.live.total, `${what} total lots`, 0, 100_000)
  }
  return p
}

function stop(v: unknown, n: number): Stop {
  const what = `Stop ${n + 1}`
  if (!isObject(v)) return fail(`${what} must be an object.`)
  const windowStart = num(v.windowStart, `${what} window start`, 0, 24 * 60)
  const windowEnd = num(v.windowEnd, `${what} window end`, windowStart, 24 * 60)
  const s: Stop = {
    id: text(v.id, `${what} id`, 64),
    name: text(v.name, `${what} name`),
    short: text(v.short, `${what} short name`),
    address: text(v.address, `${what} address`),
    ...place(v, what),
    windowStart,
    windowEnd,
    service: num(v.service, `${what} unloading time`, 0, 180),
    cargo: CARGO.includes(v.cargo as Cargo) ? (v.cargo as Cargo) : fail(`${what} cargo must be one of ${CARGO.join(', ')}.`),
    area: text(v.area, `${what} area`),
    forecast: text(v.forecast, `${what} forecast`),
    parking: parking(v.parking, what),
  }
  // an address search that matched more than one place, for the console to ask about
  if (v.review !== undefined) {
    const r = v.review
    if (!isObject(r) || !Array.isArray(r.candidates) || r.candidates.length > 10) return fail(`${what} review needs its query and up to 10 candidates.`)
    s.review = { query: text(r.query, `${what} review query`), candidates: r.candidates.map((c) => text(c, `${what} review candidate`)) }
  }
  return s
}

/** The run to plan, or BadRequest saying what is wrong with it. */
export function parseRequest(body: unknown): PlanRequest {
  if (!isObject(body)) return fail('The run must be a JSON object.')
  if (!isObject(body.depot)) return fail('The run needs a depot.')
  const depot: Depot = {
    id: text(body.depot.id, 'Depot id', 64),
    name: text(body.depot.name, 'Depot name'),
    address: text(body.depot.address, 'Depot address'),
    ...place(body.depot, 'Depot'),
  }
  if (!Array.isArray(body.stops) || body.stops.length < 1 || body.stops.length > MAX_STOPS) return fail(`The run needs 1 to ${MAX_STOPS} stops.`)
  const stops = body.stops.map(stop)
  const ids = new Set([depot.id, ...stops.map((s) => s.id)])
  if (ids.size !== stops.length + 1) return fail('Every stop, and the depot, needs its own id.')
  const departure = num(body.departure, 'Departure', 0, 24 * 60 - 1)
  const profile = typeof body.profile === 'string' && Object.hasOwn(PROFILES, body.profile) ? (body.profile as ProfileId) : fail(`Profile must be one of ${Object.keys(PROFILES).join(', ')}.`)
  return { depot, stops, departure, profile }
}

export const isBadRequest = (e: unknown): e is Error => e instanceof BadRequest
