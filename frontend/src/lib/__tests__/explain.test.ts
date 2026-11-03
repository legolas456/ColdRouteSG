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
  it('names the lower cold-chain exposure, as the KPI does', () => {
    expect(summarise(result({ order: ['B', 'A'], exposure: 16 }, { exposure: 19 }), stops)).toBe('Cold-chain exposure drops by 3 minutes.')
    expect(summarise(result({ order: ['B', 'A'], exposure: 18 }, { exposure: 19 }), stops)).toBe('Cold-chain exposure drops by 1 minute.')
  })

  it('ends the list of what the plan gains with "and", as clauses', () => {
    const withPharma = [...stops, { id: 'P', cargo: 'PHARMA' }] as Stop[]
    const onTime = { P: { late: 0 } } as unknown as Plan['byId']
    const text = summarise(result({ drive: 50, exposure: 16, byId: onTime }, { drive: 40, lateMinutes: 30, exposure: 19 }), withPharma)
    expect(text).toBe('Every pharma stop lands inside its window, 10 extra minutes of driving remove 30 minutes of lateness and cold-chain exposure drops by 3 minutes.')
  })

  it('only says the shortest route is safest when it is the same route', () => {
    expect(summarise(result({}, {}), stops)).toBe('The shortest route is already the safest for these stops.')
    expect(summarise(result({ order: ['B', 'A'] }, {}), stops)).toBe('A different order scores lower on the overall risk for these stops.')
  })
})
