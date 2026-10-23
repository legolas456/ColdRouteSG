import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/route-export.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { routeCsv } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)

const stop = {
  id: 's1', name: '=SUM(1,2) "Clinic"', address: '10, Main St',
  lat: 1.31, lng: 103.8, cargo: 'PHARMA', windowStart: 540,
  windowEnd: 600, service: 10, parking: { risk: 0.3 }, trafficRisk: 0.2,
}
const row = {
  id: 's1', seq: 1, arrival: 550, start: 550, finish: 560,
  legMinutes: 10, late: 0, inRain: true, exposure: 18,
}
const result = {
  recommended: { rows: [row] },
  baseline: { rows: [{ ...row, arrival: 580, start: 580, finish: 590 }] },
}
const args = [result, { s1: stop }, 'Balanced', 540, { source: 'recorded', at: 545 }]

test('exports only the selected plan with quoted and formula-safe user text', () => {
  const csv = routeCsv(args[0], args[1], 'coldroute', args[2], args[3], args[4])
  const lines = csv.trim().split('\r\n')
  assert.equal(lines.length, 2)
  assert.match(lines[1], /^"ColdRoute","Balanced","recorded","09:05","09:00"/)
  assert.ok(lines[1].includes('"\'=SUM(1,2) ""Clinic"""'))
  assert.ok(lines[1].includes('"10, Main St"'))
  assert.ok(lines[1].endsWith('"0.3","0.2","18"'))
})

test('compare exports both route orders while baseline exports only baseline', () => {
  const compare = routeCsv(args[0], args[1], 'compare', args[2], args[3], args[4]).trim().split('\r\n')
  assert.equal(compare.length, 3)
  assert.match(compare[1], /^"ColdRoute"/)
  assert.match(compare[2], /^"Shortest route"/)
  assert.ok(compare[2].includes('"09:40"'))

  const baseline = routeCsv(args[0], args[1], 'baseline', args[2], args[3], args[4]).trim().split('\r\n')
  assert.equal(baseline.length, 2)
  assert.match(baseline[1], /^"Shortest route"/)
})

test('rejects a plan with a stop absent from the run snapshot', () => {
  assert.throws(() => routeCsv(result, {}, 'coldroute', 'Balanced', 540, args[4]), /Missing stop/)
})
