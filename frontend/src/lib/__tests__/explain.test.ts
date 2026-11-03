import { describe, expect, it } from 'vitest'
import { summarise } from '../explain'
import type { OptimiseResult, Plan, Stop } from '../types'

/** Just the plan totals summarise reads. */
const plan = (p: Partial<Plan>): Plan =>
  ({ order: ['A', 'B'], rows: [], byId: {}, drive: 40, lateMinutes: 0, rainStops: 0, exposure: 20, ...p }) as unknown as Plan
const result = (recommended: Partial<Plan>, baseline: Partial<Plan>) =>
  ({ recommended: plan(recommended), baseline: plan(baseline) }) as unknown as OptimiseResult
const stops = [{ id: 'A', cargo: 'CHILLED' }, { id: 'B', cargo: 'FROZEN' }] as Stop[]

describe('summarise', () => {
  it('names less cold cargo time on board, at the same driving', () => {
    const text = summarise(result({ order: ['B', 'A'], exposure: 16 }, { exposure: 19 }), stops)
    expect(text).toBe('3 fewer minutes of cold cargo on board.')
  })

  it('only says the shortest route is safest when it is the same route', () => {
    expect(summarise(result({}, {}), stops)).toBe('The shortest route is already the safest for these stops.')
    expect(summarise(result({ order: ['B', 'A'] }, {}), stops)).toBe('A different order scores lower on the overall risk for these stops.')
  })
})
