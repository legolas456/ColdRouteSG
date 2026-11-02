import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

async function loadTs(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)
}

const { objectiveContribution, stopRawTerms, REFERENCE_MINUTES } = await loadTs('../src/lib/objective.ts')
const { PROFILES } = await loadTs('../src/lib/profiles.ts')

async function loadOptimizerWithFixedRoads() {
  const source = await readFile(new URL('../src/lib/optimizer.ts', import.meta.url), 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const roads = {
    travel: () => ({ minutes: 10, km: 5 }),
    legGeometry: (a, b) => [[a.lng, a.lat], [b.lng, b.lat]],
  }
  const modules = {
    '../data/sample': { CARGO_SENSITIVITY: { PHARMA: 1, FROZEN: 0.8, CHILLED: 0.6 }, RAIN_CELLS: [] },
    './roads': roads,
    './objective': { objectiveContribution, stopRawTerms },
    // these tests plan without live traffic, so no leg is ever scaled
    './traffic': { legFactor: () => 1 },
  }
  const out = { exports: {} }
  new Function('require', 'module', 'exports', javascript)((id) => {
    if (!(id in modules)) throw new Error(`Unexpected optimizer dependency: ${id}`)
    return modules[id]
  }, out, out.exports)
  return out.exports
}

test('the five fixed scales make the Balanced profile interpretable', () => {
  assert.deepEqual(REFERENCE_MINUTES, { drive: 20, late: 15, weather: 15, parking: 15, cold: 120 })
  const n = 2
  const raw = { drive: 20, late: 15, weather: 15, parking: 15, cold: 120 }
  const c = objectiveContribution(raw, n, PROFILES.balanced.weights)
  assert.deepEqual(c, { drive: 0.15, late: 0.15, weather: 0.05, parking: 0.05, cold: 0.1 })
  assert.equal(Object.values(c).reduce((sum, value) => sum + value, 0), 0.5)
})

test('severe lateness is not capped or re-scaled against candidate routes', () => {
  const weights = PROFILES.balanced.weights
  const quiet = { drive: 20, late: 0, weather: 0, parking: 0, cold: 0 }
  const late = { ...quiet, late: 60 }
  const quietCost = objectiveContribution(quiet, 1, weights)
  const lateCost = objectiveContribution(late, 1, weights)
  assert.equal(lateCost.late - quietCost.late, 1.2)
  assert.equal(lateCost.drive, quietCost.drive)
})

test('rain and parking contribute independently while cargo tracks time on board', () => {
  const input = {
    driveMinutes: 12, lateMinutes: 3, serviceMinutes: 10,
    rainSeverity: 0.5, parkingRisk: 0.8, cargoSensitivity: 1,
    onBoardMinutes: 45,
  }
  assert.deepEqual(stopRawTerms(input), { drive: 12, late: 3, weather: 5, parking: 8, cold: 45 })
  assert.equal(stopRawTerms({ ...input, parkingRisk: 0 }).weather, 5)
  assert.equal(stopRawTerms({ ...input, rainSeverity: 0 }).parking, 8)
})

test('every profile has non-negative weights summing to one', () => {
  for (const profile of Object.values(PROFILES)) {
    const values = Object.values(profile.weights)
    assert.ok(values.every((value) => value >= 0 && Number.isFinite(value)))
    assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) < 1e-9)
  }
  assert.deepEqual(PROFILES.fastest.weights, { drive: 1, late: 0, weather: 0, parking: 0, cold: 0 })
})

test('the optimiser serves a tight window first when drive times tie', async () => {
  const { optimise } = await loadOptimizerWithFixedRoads()
  const depot = { id: 'D', lng: 103.7, lat: 1.3 }
  const stop = (id, windowEnd) => ({
    id, name: id, lng: 103.8, lat: 1.3, windowStart: 0, windowEnd,
    service: 5, cargo: 'PHARMA', area: 'Test', trafficRisk: 0,
    parking: { risk: 0, distanceKm: 0 },
  })
  const result = optimise(depot, [stop('relaxed', 100), stop('urgent', 15)], 0, PROFILES.balanced.weights, [])
  assert.deepEqual(result.baseline.order, ['relaxed', 'urgent'])
  assert.deepEqual(result.recommended.order, ['urgent', 'relaxed'])
  assert.equal(result.recommended.lateMinutes, 0)
  assert.equal(result.baseline.lateMinutes, 10)
})
