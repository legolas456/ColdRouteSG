// Builds src/data/sg-mask.json: a polygon that covers everything around
// Singapore, with Singapore's national boundary (incl. territorial waters)
// cut out as holes. The map draws it on top of the basemap so Johor and the
// Riau islands are dimmed and the island stays in focus.
//
// Source: OpenStreetMap relation 536780 via Nominatim (ODbL).
// Run: npm run data:sg-mask
import { writeFile } from 'node:fs/promises'

const url =
  'https://nominatim.openstreetmap.org/search?country=Singapore&featureType=country' +
  '&polygon_geojson=1&polygon_threshold=0.003&format=json&limit=1'
const res = await fetch(url, { headers: { 'User-Agent': 'ColdRouteSG-student-project/1.0' } })
if (!res.ok) throw new Error(`Nominatim ${res.status}`)
const [place] = await res.json()
const g = place.geojson
const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]

const area = (ring) => ring.reduce((s, [x1, y1], i) => {
  const [x2, y2] = ring[(i + 1) % ring.length]
  return s + (x1 * y2 - x2 * y1)
}, 0) / 2
const round = (ring) => ring.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)])

// RFC 7946: outer ring counter-clockwise, holes clockwise
const outer = [[100, -3], [108, -3], [108, 5], [100, 5], [100, -3]]
const holes = polys.map((p) => {
  const ring = round(p[0])
  return area(ring) > 0 ? ring.reverse() : ring
})

const mask = {
  type: 'Feature',
  properties: { source: 'OpenStreetMap relation 536780 (ODbL)' },
  geometry: { type: 'Polygon', coordinates: [outer, ...holes] },
}
await writeFile(new URL('../src/data/sg-mask.json', import.meta.url), JSON.stringify(mask) + '\n')
console.log(`sg-mask.json: ${holes.length} holes, ${holes.reduce((n, h) => n + h.length, 0)} points`)
