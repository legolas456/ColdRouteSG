// What a plan reads, gathered on the server: the NEA forecast and HDB free lots
// (data.gov.sg, as the console reads them), and from the traffic bucket the
// URA and mall carparks, the live road-speed grid and typical traffic, all
// published by the scheduled jobs. Each is parsed by the console's own code.
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import type { TypicalTraffic } from '../../frontend/src/lib/conditions'
import { type Feed, FEED_URLS, type Json, type LiveFeeds, parseCarparks, parseLtaCarparks, parseWeather } from '../../frontend/src/lib/feeds'
import { parseTrafficGrid, type TrafficGrid } from '../../frontend/src/lib/traffic'

export interface Sources {
  s3: Pick<S3Client, 'send'>
  bucket: string
  trafficKey: string
}

/** The feeds a plan reads, and the road-speed grid as published, for the console's map. */
export interface Inputs {
  feeds: LiveFeeds
  rawTraffic: Json | null
}

const TIMEOUT_MS = 12_000

async function fetchJson(url: string): Promise<Json> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as Json
}

/** An object from the traffic bucket as JSON, or null if it is not there. */
export async function readJson(src: Sources, key: string): Promise<Json | null> {
  try {
    const r = await src.s3.send(new GetObjectCommand({ Bucket: src.bucket, Key: key }))
    return JSON.parse(await r.Body!.transformToString()) as Json
  } catch (e) {
    if ((e as { name?: string }).name === 'NoSuchKey') return null
    throw e
  }
}

const settle = async <T>(work: Promise<T | null>): Promise<Feed<T>> => {
  try {
    const data = await work
    return data === null ? { status: 'idle' } : { status: 'ok', data }
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

export async function readInputs(src: Sources, now = Date.now()): Promise<Inputs> {
  let rawTraffic: Json | null = null
  const [weather, carparks, ltaCarparks, traffic] = await Promise.all([
    settle(fetchJson(FEED_URLS.weather).then(parseWeather)),
    settle(fetchJson(FEED_URLS.carparks).then(parseCarparks)),
    settle(readJson(src, 'parking/carparks.json').then((raw) => (raw ? parseLtaCarparks(raw) : null))),
    settle<TrafficGrid>(
      readJson(src, src.trafficKey).then((raw) => {
        rawTraffic = raw
        return raw ? parseTrafficGrid(raw) : null
      }),
    ),
  ])
  return { feeds: { weather, carparks, ltaCarparks, cameras: { status: 'idle' }, traffic, fetchedAt: now }, rawTraffic }
}

// ---- typical traffic: the slot a departure falls in (backend/app/services/typical.py) ----

const SLOT_MINUTES = 15

/** Weekday or weekend, and the 15-minute slot, of `minutes` after midnight today in Singapore. */
export function typicalSlot(minutes: number, now = Date.now()) {
  const day = new Date(now + 8 * 3600_000).getUTCDay()
  const m = Math.floor(Math.max(0, Math.min(24 * 60 - 1, minutes)) / SLOT_MINUTES) * SLOT_MINUTES
  const slot = `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`
  return { dayType: day === 0 || day === 6 ? ('weekend' as const) : ('weekday' as const), slot }
}

// the slots the latest nightly build published (backend/app/services/typical.py INDEX_KEY)
const TYPICAL_INDEX = 'traffic/typical/index.json'

/**
 * Typical traffic for a departure today, with the grid as published; or the
 * reason there is none yet. As in the backend, the latest build's index
 * decides: a slot it left out still has an older grid in the bucket.
 */
export async function readTypical(src: Sources, departure: number, now = Date.now()): Promise<TypicalTraffic & { raw: Json | null }> {
  const { dayType, slot } = typicalSlot(departure, now)
  const index = await readJson(src, TYPICAL_INDEX)
  const slots = (index?.slots as Record<string, Record<string, unknown>> | undefined)?.[dayType]
  const raw = slots && Object.hasOwn(slots, slot) ? await readJson(src, `traffic/typical/${dayType}/${slot}.json`) : null
  if (!raw) {
    return {
      grid: null,
      raw: null,
      reason: `No typical traffic for a ${dayType} at ${slot.slice(0, 2)}:${slot.slice(2)} yet: it needs at least 3 kept readings in that slot.`,
    }
  }
  return { grid: parseTrafficGrid(raw), raw }
}
