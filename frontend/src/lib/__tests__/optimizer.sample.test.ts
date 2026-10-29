import { expect, it, vi } from 'vitest'
import { DEPARTURE, DEPOT, PROFILES, RAIN_CELLS, SAMPLE_STOPS } from '../../data/sample'
import { optimise } from '../optimizer'

it('keeps the recorded Pharma demo reproducible with real bundled OSRM times', () => {
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('Recorded optimiser regression must not call a live service')
  })
  try {
    const result = optimise(DEPOT, SAMPLE_STOPS, DEPARTURE, PROFILES.pharma.weights, RAIN_CELLS)
    expect(result.evaluated).toBe(5040)
    // Exhaustive optimum under the normalised objective and the Pharma profile.
    // Update it only when the objective, scales or profile weights change on purpose.
    expect(result.recommended.order).toEqual(['HV', 'NUH', 'TPG', 'AMK', 'WHC', 'TAM', 'MBFC'])
    expect(result.recommended.lateStops).toBe(0)
    expect(result.recommended.rainStops).toBe(0)
    expect(result.baseline.lateStops).toBe(1)
    expect(result.recommended.drive).toBeGreaterThan(result.baseline.drive)
    expect(result.recommended.exposure).toBeLessThan(result.baseline.exposure)
    expect(result.recommended.cost).toBeLessThanOrEqual(result.baseline.cost)
    expect(network).not.toHaveBeenCalled()
  } finally {
    network.mockRestore()
  }
})
