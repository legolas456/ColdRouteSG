import { API_URL, api } from './api'
import { AUTH_ENABLED } from './auth'
import type { Conditions } from './conditions'
import { mergeLegs, setDriveTimes } from './roads'
import { parseTrafficGrid } from './traffic'
import type { Depot, OptimiseResult, PlanResponse, ProfileId, Stop } from './types'

/**
 * Planning a run in the cloud: the planner on AWS Lambda (planner/, POST
 * /api/plan) reads the conditions itself, measures drive times with Amazon
 * Location Service and runs this console's own optimiser. For signed-in users
 * on live data; the console plans in the browser when it cannot be reached.
 */
export const CLOUD_PLANNING = Boolean(API_URL) && AUTH_ENABLED

export interface CloudRun {
  depot: Depot
  stops: Stop[]
  /** minutes after midnight, Singapore time */
  departure: number
  profile: ProfileId
}

// API Gateway gives up at 30 s
const TIMEOUT_MS = 30_000

/**
 * The run planned in the cloud, as the console's own result and conditions.
 * The drive times and road lines it used go into the console's tables, so the
 * map, the return to the depot and a re-plan in the browser agree with it.
 */
export async function planInCloud(run: CloudRun): Promise<{ result: OptimiseResult; conditions: Conditions }> {
  const plan = await api<PlanResponse>('/api/plan', { method: 'POST', body: JSON.stringify(run) }, { signInTo: 'plan in the cloud', timeoutMs: TIMEOUT_MS })
  const { traffic, ...conditions } = plan.conditions
  setDriveTimes([run.depot, ...conditions.stops], plan.times)
  mergeLegs(plan.legs)
  return {
    result: plan.result,
    conditions: { ...conditions, traffic: traffic ? parseTrafficGrid(traffic) : null, cloud: { roads: plan.roads.source, ms: plan.elapsedMs } },
  }
}
