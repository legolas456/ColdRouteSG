import type { ProfileId, Weights } from './types'

/** Pilot hypotheses; freeze or revise before evaluating held-out runs. */
export const PROFILES: Record<ProfileId, { label: string; hint: string; weights: Weights }> = {
  pharma: {
    label: 'Pharma',
    hint: 'Protect windows and cold-chain first',
    weights: { drive: 0.15, late: 0.35, weather: 0.10, parking: 0.05, cold: 0.35 },
  },
  balanced: {
    label: 'Balanced',
    hint: 'Trade a little time for lower risk',
    weights: { drive: 0.30, late: 0.30, weather: 0.10, parking: 0.10, cold: 0.20 },
  },
  fastest: {
    label: 'Fastest',
    hint: 'Minimise driving only',
    weights: { drive: 1, late: 0, weather: 0, parking: 0, cold: 0 },
  },
}
