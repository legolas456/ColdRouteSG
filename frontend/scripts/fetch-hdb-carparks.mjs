// Builds src/data/hdb-carparks.json: every HDB carpark with its number, address
// and position, so Live mode can find the nearest carpark to a stop and read its
// free lots from the live availability feed (which has numbers but no places).
// Carparks rarely move, so a snapshot is enough; availability stays live.
//
// Source: HDB Carpark Information on data.gov.sg (SVY21 coordinates, converted
// to WGS84 here).
//
//   npm run data:hdb-carparks
import { writeFile } from 'node:fs/promises'

const RESOURCE = 'd_23f946fa557947f93a8043bbef41dd09'
const URL_BASE = `https://data.gov.sg/api/action/datastore_search?resource_id=${RESOURCE}`

// ---- SVY21 (EPSG:3414) to WGS84, after the published SLA formulas ----------
const a = 6378137
const f = 1 / 298.257223563
const oLat = 1.366666
const oLon = 103.833333
const oN = 38744.572
const oE = 28001.642
const k = 1
const b = a * (1 - f)
const e2 = 2 * f - f * f
const e4 = e2 * e2
const e6 = e4 * e2
const A0 = 1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256
const A2 = (3 / 8) * (e2 + e4 / 4 + (15 * e6) / 128)
const A4 = (15 / 256) * (e4 + (3 * e6) / 4)
const A6 = (35 * e6) / 3072
const rad = (d) => (d * Math.PI) / 180
const calcM = (lat) => {
  const r = rad(lat)
  return a * (A0 * r - A2 * Math.sin(2 * r) + A4 * Math.sin(4 * r) - A6 * Math.sin(6 * r))
}
const calcRho = (sin2) => (a * (1 - e2)) / Math.pow(1 - e2 * sin2, 1.5)
const calcV = (sin2) => a / Math.sqrt(1 - e2 * sin2)

export function svy21ToWgs84(N, E) {
  const Nprime = N - oN
  const Mprime = calcM(oLat) + Nprime / k
  const n = (a - b) / (a + b)
  const n2 = n * n
  const n3 = n2 * n
  const n4 = n2 * n2
  const G = a * (1 - n) * (1 - n2) * (1 + (9 * n2) / 4 + (225 * n4) / 64) * (Math.PI / 180)
  const sigma = (Mprime * Math.PI) / (180 * G)
  const latPrime =
    sigma +
    ((3 * n) / 2 - (27 * n3) / 32) * Math.sin(2 * sigma) +
    ((21 * n2) / 16 - (55 * n4) / 32) * Math.sin(4 * sigma) +
    ((151 * n3) / 96) * Math.sin(6 * sigma) +
    ((1097 * n4) / 512) * Math.sin(8 * sigma)
  const sin2 = Math.sin(latPrime) ** 2
  const rhoPrime = calcRho(sin2)
  const vPrime = calcV(sin2)
  const psi = vPrime / rhoPrime
  const psi2 = psi * psi
  const psi3 = psi2 * psi
  const psi4 = psi3 * psi
  const t = Math.tan(latPrime)
  const t2 = t * t
  const t4 = t2 * t2
  const t6 = t4 * t2
  const Eprime = E - oE
  const x = Eprime / (k * vPrime)
  const x2 = x * x
  const x3 = x2 * x
  const x5 = x3 * x2
  const x7 = x5 * x2
  const latFactor = t / (k * rhoPrime)
  const lat =
    latPrime -
    latFactor * ((Eprime * x) / 2) +
    latFactor * ((Eprime * x3) / 24) * (-4 * psi2 + 9 * psi * (1 - t2) + 12 * t2) -
    latFactor *
      ((Eprime * x5) / 720) *
      (8 * psi4 * (11 - 24 * t2) - 12 * psi3 * (21 - 71 * t2) + 15 * psi2 * (15 - 98 * t2 + 15 * t4) + 180 * psi * (5 * t2 - 3 * t4) + 360 * t4) +
    latFactor * ((Eprime * x7) / 40320) * (1385 - 3633 * t2 + 4095 * t4 + 1575 * t6)
  const sec = 1 / Math.cos(latPrime)
  const lon =
    rad(oLon) +
    x * sec -
    ((x3 * sec) / 6) * (psi + 2 * t2) +
    ((x5 * sec) / 120) * (-4 * psi3 * (1 - 6 * t2) + psi2 * (9 - 68 * t2) + 72 * psi * t2 + 24 * t4) -
    ((x7 * sec) / 5040) * (61 + 662 * t2 + 1320 * t4 + 720 * t6)
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI]
}

// Self-check against OneMap: Bedok Mall, X 38676.90 Y 34108.34 -> 1.324736, 103.929256
{
  const [lng, lat] = svy21ToWgs84(34108.33606372215, 38676.9034392368)
  if (Math.abs(lng - 103.929256) > 2e-5 || Math.abs(lat - 1.324736) > 2e-5) {
    throw new Error(`SVY21 conversion is off: ${lng}, ${lat}`)
  }
}

const titleCase = (s) =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bBlk\b/g, 'Blk')
    .replace(/\b(Mscp|Hdb)\b/g, (m) => m.toUpperCase())
    // block suffixes: "Blk 2a" -> "Blk 2A"
    .replace(/\b(\d+)([a-z])\b/g, (_, n, l) => n + l.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim()

const rows = []
for (let offset = 0; ; offset += 1000) {
  const res = await fetch(`${URL_BASE}&limit=1000&offset=${offset}`, { headers: { 'User-Agent': 'ColdRouteSG-student-project/1.0' } })
  if (!res.ok) throw new Error(`data.gov.sg ${res.status}`)
  const { result } = await res.json()
  rows.push(...result.records)
  if (rows.length >= result.total || !result.records.length) break
  await new Promise((r) => setTimeout(r, 400))
}

const round = (n) => Math.round(n * 1e5) / 1e5
const carparks = rows
  .filter((r) => r.x_coord && r.y_coord)
  .map((r) => {
    const [lng, lat] = svy21ToWgs84(Number(r.y_coord), Number(r.x_coord))
    return [r.car_park_no, titleCase(r.address), round(lng), round(lat)]
  })
  .sort((p, q) => p[0].localeCompare(q[0]))

const out = {
  source: 'HDB Carpark Information, data.gov.sg (Singapore Open Data Licence)',
  fetched: new Date().toISOString().slice(0, 10),
  fields: ['no', 'address', 'lng', 'lat'],
  carparks,
}
await writeFile(new URL('../src/data/hdb-carparks.json', import.meta.url), JSON.stringify(out))
console.log(`wrote ${carparks.length} carparks`)
