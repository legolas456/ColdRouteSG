import { afterEach, describe, expect, it, vi } from 'vitest'
import TRAFFIC_GRID from '../../../../backend/tests/fixtures/traffic_grid_expected.json'
import { DEPOT, PROFILES, SAMPLE_STOPS } from '../../data/sample'
import { optimise } from '../optimizer'
import type { PlanResponse } from '../types'

const session = vi.hoisted(() => ({ fetchAuthSession: vi.fn() }))
vi.mock('aws-amplify', () => ({ Amplify: { configure: vi.fn() } }))
vi.mock('aws-amplify/auth', () => ({ fetchAuthSession: session.fetchAuthSession, signIn: vi.fn(), signOut: vi.fn(), confirmSignIn: vi.fn() }))

const API = 'https://api.example.com'

/** planner.ts, and the road tables it fills, with the console built against an API and a user pool. */
async function load(api = API) {
  vi.resetModules()
  vi.stubEnv('VITE_COGNITO_USER_POOL_ID', 'ap-southeast-1_test')
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'client')
  vi.stubEnv('VITE_API_BASE_URL', api)
  return { ...(await import('../planner')), roads: await import('../roads') }
}

const signedIn = () => session.fetchAuthSession.mockResolvedValue({ tokens: { idToken: { toString: () => 'id-token', payload: {} } } })
const reply = (status: number, body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))

// two stops the bundled OSRM snapshot does not know
const STOPS = SAMPLE_STOPS.slice(0, 2).map((s, i) => ({ ...s, id: `C${i + 1}` }))
const RUN = { depot: DEPOT, stops: STOPS, departure: 9 * 60, profile: 'pharma' as const }

// what the planner answers for RUN (planner/src/plan.ts)
const PLANNED: PlanResponse = {
  result: optimise(DEPOT, STOPS, 9 * 60, PROFILES.pharma.weights, []),
  conditions: { mode: 'live', source: 'live', at: 8 * 60 + 35, rain: [], stops: STOPS, traffic: TRAFFIC_GRID, notes: [] },
  legs: {
    'D>C1': [
      [103.7205, 1.3088],
      [103.75, 1.3],
      [103.783, 1.294],
    ],
  },
  times: [
    { from: 'C1', to: 'C2', minutes: 21.4, km: 18.2 },
    { from: 'C2', to: 'C1', minutes: 19.9, km: 17.6 },
  ],
  roads: { source: 'location', cached: 2, measured: 4, billed: 7 },
  elapsedMs: 1400,
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  session.fetchAuthSession.mockReset()
})

describe('planInCloud', () => {
  it('sends the run with the ID token and takes back the plan', async () => {
    const { planInCloud } = await load()
    signedIn()
    const fetch = reply(200, PLANNED)
    const { result, conditions } = await planInCloud(RUN)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${API}/api/plan`)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: 'Bearer id-token' })
    expect(JSON.parse(init.body as string)).toEqual(RUN)
    expect(result).toEqual(PLANNED.result)
    expect(conditions.cloud).toEqual({ roads: 'location', ms: 1400 })
    // the road speeds as the console's own grid
    expect(conditions.traffic?.cells.size).toBe(TRAFFIC_GRID.cells.length)
    expect(conditions.traffic?.slowShare).toBe(0.639)
  })

  it("puts the plan's drive times and road lines in the console's tables", async () => {
    const { planInCloud, roads } = await load()
    signedIn()
    reply(200, PLANNED)
    expect(roads.travel(STOPS[0], STOPS[1]).real).toBe(false)
    await planInCloud(RUN)
    expect(roads.travel(STOPS[0], STOPS[1])).toEqual({ minutes: 21.4, km: 18.2, real: true })
    expect(roads.travel(STOPS[1], STOPS[0]).minutes).toBe(19.9)
    expect(roads.legGeometry(DEPOT, STOPS[0])).toEqual(PLANNED.legs['D>C1'])
  })

  it('says why the cloud planner did not plan the run', async () => {
    const { planInCloud } = await load()
    signedIn()
    reply(500, { detail: 'The cloud planner hit an error; its CloudWatch log says why.' })
    await expect(planInCloud(RUN)).rejects.toMatchObject({ status: 500, message: 'The cloud planner hit an error; its CloudWatch log says why.' })
    session.fetchAuthSession.mockResolvedValue({ tokens: undefined })
    await expect(planInCloud(RUN)).rejects.toMatchObject({ status: 401, message: 'Sign in again to plan in the cloud.' })
  })

  it('is off without the API', async () => {
    expect((await load()).CLOUD_PLANNING).toBe(true)
    expect((await load('')).CLOUD_PLANNING).toBe(false)
  })
})
