// Snapshot of the 47 NEA 2-hour forecast areas and their label points, from
// data.gov.sg. A stop added through the OneMap search takes the nearest area,
// so Recorded mode (no live feed) still knows where it is.
//
//   npm run data:nea-areas
import { writeFile } from 'node:fs/promises'

const URL_NEA = 'https://api.data.gov.sg/v1/environment/2-hour-weather-forecast'
const res = await fetch(URL_NEA)
if (!res.ok) throw new Error(`NEA answered ${res.status}`)
const body = await res.json()
const areas = body.area_metadata
  .map((a) => [a.name, Math.round(a.label_location.longitude * 1e5) / 1e5, Math.round(a.label_location.latitude * 1e5) / 1e5])
  .sort((a, b) => a[0].localeCompare(b[0]))
if (areas.length < 40) throw new Error(`Only ${areas.length} areas, refusing to write`)
await writeFile(
  new URL('../src/data/nea-areas.json', import.meta.url),
  JSON.stringify({ source: URL_NEA, fetchedAt: new Date().toISOString(), fields: ['name', 'lng', 'lat'], areas }) + '\n',
)
console.log(`wrote ${areas.length} areas`)
