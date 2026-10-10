// Fetches a real driving-time matrix and per-leg road geometry from the public
// OSRM demo server for the sample run, and writes src/data/osrm.json.
// The UI then draws any stop order by concatenating legs, with no runtime calls.
//
//   npm run data:osrm
import { writeFile } from 'node:fs/promises'

const NODES = {
  D: [103.7205, 1.3088],
  NUH: [103.783, 1.294],
  WHC: [103.7948, 1.4246],
  AMK: [103.8484, 1.3692],
  TAM: [103.9447, 1.3525],
  MBFC: [103.854, 1.2793],
  TPG: [103.8457, 1.2765],
  HV: [103.796, 1.311],
  // address-book entries a dispatcher can add during the demo
  BDK: [103.9295, 1.3248],
  KKH: [103.8463, 1.3105],
  JWL: [103.9894, 1.3602],
}

const OSRM = 'https://router.project-osrm.org'
const ids = Object.keys(NODES)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const round = (n) => Math.round(n * 1e5) / 1e5

// Ramer–Douglas–Peucker simplification to keep the bundle small.
function simplify(points, tolerance) {
  if (points.length < 3) return points
  const sqTol = tolerance * tolerance
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    let maxSq = 0
    let index = -1
    const [x1, y1] = points[first]
    const [x2, y2] = points[last]
    for (let i = first + 1; i < last; i++) {
      const [x, y] = points[i]
      let dx = x2 - x1
      let dy = y2 - y1
      let t = dx || dy ? ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy) : 0
      t = Math.max(0, Math.min(1, t))
      dx = x - (x1 + t * dx)
      dy = y - (y1 + t * dy)
      const sq = dx * dx + dy * dy
      if (sq > maxSq) {
        maxSq = sq
        index = i
      }
    }
    if (maxSq > sqTol && index > 0) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url)
    if (res.ok) return res.json()
    await sleep(800 * (attempt + 1))
  }
  throw new Error(`OSRM request failed: ${url}`)
}

const coordStr = ids.map((id) => NODES[id].join(',')).join(';')
const table = await getJson(`${OSRM}/table/v1/driving/${coordStr}?annotations=duration,distance`)

const minutes = {}
const km = {}
ids.forEach((a, i) => {
  minutes[a] = {}
  km[a] = {}
  ids.forEach((b, j) => {
    minutes[a][b] = Math.round((table.durations[i][j] / 60) * 10) / 10
    km[a][b] = Math.round((table.distances[i][j] / 1000) * 10) / 10
  })
})

const legs = {}
for (const a of ids) {
  for (const b of ids) {
    if (a === b || b === 'D') continue
    const url = `${OSRM}/route/v1/driving/${NODES[a].join(',')};${NODES[b].join(',')}?overview=full&geometries=geojson`
    const data = await getJson(url)
    const coords = data.routes[0].geometry.coordinates
    legs[`${a}>${b}`] = simplify(coords, 0.00012).map(([x, y]) => [round(x), round(y)])
    process.stdout.write('.')
    await sleep(120)
  }
}

await writeFile(
  new URL('../src/data/osrm.json', import.meta.url),
  JSON.stringify({ source: 'router.project-osrm.org', fetchedAt: new Date().toISOString(), minutes, km, legs }),
)
console.log(`\nWrote ${Object.keys(legs).length} legs`)
