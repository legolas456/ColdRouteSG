import { afterEach, describe, expect, it, vi } from 'vitest'
// The run the backend tests post to POST /api/routes/history (backend/tests/
// test_route_history.py); both sides read this file, so the payload cannot drift.
// Regenerate it from plannedRun() only when the payload or the sample plan changes on purpose.
import SAVED_SAMPLE from '../../../../backend/tests/fixtures/planned_run_sample.json'
import { DEPARTURE, DEPOT, PROFILES, RAIN_CELLS, SAMPLE_STOPS } from '../../data/sample'
import type { PlannedRun, SavedRun } from '../history'
import { optimise } from '../optimizer'

const session = vi.hoisted(() => ({ fetchAuthSession: vi.fn() }))
vi.mock('aws-amplify', () => ({ Amplify: { configure: vi.fn() } }))
vi.mock('aws-amplify/auth', () => ({ fetchAuthSession: session.fetchAuthSession, signIn: vi.fn(), signOut: vi.fn(), confirmSignIn: vi.fn() }))

const API = 'https://api.example.com'

/** history.ts with the console built against an API and a user pool. */
async function load(env: { api?: string } = { api: API }) {
  vi.resetModules()
  vi.stubEnv('VITE_COGNITO_USER_POOL_ID', 'ap-southeast-1_test')
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'client')
  vi.stubEnv('VITE_API_BASE_URL', env.api ?? '')
  return import('../history')
}

const signedIn = (token = 'id-token') =>
  session.fetchAuthSession.mockResolvedValue({ tokens: { idToken: { toString: () => token, payload: { email: 'd@example.com' } } } })

const reply = (status: number, body?: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status }))

const sampleRun = (): Promise<PlannedRun> =>
  load().then(({ plannedRun }) => {
    const result = optimise(DEPOT, SAMPLE_STOPS, DEPARTURE, PROFILES.pharma.weights, RAIN_CELLS)
    return plannedRun({ depot: DEPOT, stops: SAMPLE_STOPS, departure: DEPARTURE, profile: 'pharma', dataMode: 'recorded', result })
  })

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  session.fetchAuthSession.mockReset()
})

describe('plannedRun', () => {
  it('sends the sample plan as the backend expects it', async () => {
    expect(await sampleRun()).toEqual(SAVED_SAMPLE)
  })

  it('keeps both plans, each visiting every stop once', async () => {
    const run = await sampleRun()
    const ids = run.stops.map((s) => s.id).sort()
    expect([...run.plan.order].sort()).toEqual(ids)
    expect([...run.shortest.order].sort()).toEqual(ids)
    // the shortest route really is the shorter drive; ColdRoute avoids its late stop
    expect(run.shortest.total_travel_minutes).toBeLessThan(run.plan.total_travel_minutes)
    expect(run.plan.late_stops).toBe(0)
    expect(run.shortest.late_stops).toBe(1)
    expect(run.plan.total_service_minutes).toBe(SAMPLE_STOPS.reduce((sum, s) => sum + s.service, 0))
  })

  it('writes times the backend accepts', async () => {
    const run = await sampleRun()
    for (const t of [run.departure_time, ...run.stops.flatMap((s) => [s.window_start, s.window_end])]) expect(t).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
  })
})

describe('the history API', () => {
  it('saves a run with the ID token and returns its id', async () => {
    const { saveRun } = await load()
    signedIn('token-123')
    const fetch = reply(201, { route_id: 'r-1' })
    const run = await sampleRun()
    expect(await saveRun(run)).toBe('r-1')
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${API}/api/routes/history`)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: 'Bearer token-123', 'content-type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual(run)
  })

  it("passes on the backend's own reason", async () => {
    const { saveRun } = await load()
    signedIn()
    reply(503, { detail: 'Route history is temporarily unavailable, so this run was not saved.' })
    await expect(saveRun(await sampleRun())).rejects.toMatchObject({ status: 503, message: 'Route history is temporarily unavailable, so this run was not saved.' })
  })

  it('asks to sign in again when the API refuses the token', async () => {
    const { listRuns } = await load()
    signedIn()
    reply(401, { message: 'Unauthorized' })
    await expect(listRuns()).rejects.toMatchObject({ status: 401, message: 'Sign in again to use your saved runs.' })
  })

  it('says so when the API cannot be reached', async () => {
    const { listRuns } = await load()
    signedIn()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    await expect(listRuns()).rejects.toMatchObject({ status: 0, message: 'Could not reach the ColdRoute API.' })
  })

  it('sends nothing without a session', async () => {
    const { saveRun } = await load()
    session.fetchAuthSession.mockResolvedValue({ tokens: undefined })
    const fetch = reply(201, { route_id: 'r-1' })
    await expect(saveRun(await sampleRun())).rejects.toMatchObject({ status: 401 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('encodes route ids, which hold # and +', async () => {
    const { deleteRun } = await load()
    signedIn()
    const fetch = reply(204)
    await expect(deleteRun('2026-10-29T03:00:01.000+00:00#a1')).resolves.toBeUndefined()
    expect(fetch.mock.calls[0][0]).toBe(`${API}/api/routes/history/2026-10-29T03%3A00%3A01.000%2B00%3A00%23a1`)
    expect((fetch.mock.calls[0][1] as RequestInit).method).toBe('DELETE')
  })

  it('is off without an API URL', async () => {
    expect((await load({ api: '' })).HISTORY_ENABLED).toBe(false)
    expect((await load()).HISTORY_ENABLED).toBe(true)
  })
})

describe('reopenRun', () => {
  const saved = (request: SavedRun['request']): SavedRun => ({
    route_id: 'r-1',
    created_at: '2026-10-29T03:00:00+00:00',
    depot_name: request.depot_name,
    departure_time: request.departure_time,
    stop_count: request.stops.length,
    request,
    result: SAVED_SAMPLE.plan,
  })
  const sampleRequest = (): SavedRun['request'] => {
    const { plan: _plan, shortest: _shortest, ...request } = SAVED_SAMPLE as PlannedRun
    return structuredClone(request)
  }

  it('brings a saved sample run back as the sample', async () => {
    const { reopenRun } = await load()
    const run = await reopenRun(saved(sampleRequest()))
    // the sample depot keeps its id D, which keys the bundled road times
    expect(run.depot).toEqual(DEPOT)
    expect(run.stops).toEqual(SAMPLE_STOPS)
    expect(run.departure).toBe(DEPARTURE)
    expect(run.profile).toBe('pharma')
  })

  it('keeps what the user set: windows, unloading time and cargo', async () => {
    const { reopenRun } = await load()
    const request = sampleRequest()
    Object.assign(request.stops[0], { window_start: '13:15', window_end: '15:00', service_minutes: 25, cargo: 'FROZEN' })
    const [first] = (await reopenRun(saved(request))).stops
    expect(first).toMatchObject({ id: 'NUH', windowStart: 13 * 60 + 15, windowEnd: 15 * 60, service: 25, cargo: 'FROZEN' })
  })

  it('rebuilds a depot and a stop that are not in the sample', async () => {
    const { reopenRun } = await load()
    const request = sampleRequest()
    request.depot = { lat: 1.3521, lng: 103.9443 }
    request.depot_name = 'Changi Cold Hub'
    request.stops = [{ id: 'P238801', name: 'Ion Orchard', address: '2 Orchard Turn, 238801', lat: 1.304, lng: 103.8318, window_start: '10:00', window_end: '12:00', service_minutes: 15, cargo: 'CHILLED' }]
    const run = await reopenRun(saved(request))
    expect(run.depot).toMatchObject({ id: 'D:103.944300,1.352100', name: 'Changi Cold Hub', lat: 1.3521, lng: 103.9443 })
    expect(run.stops).toHaveLength(1)
    expect(run.stops[0]).toMatchObject({ id: 'P238801', name: 'Ion Orchard', windowStart: 600, windowEnd: 720, service: 15, cargo: 'CHILLED', lat: 1.304, lng: 103.8318 })
    expect(run.stops[0].area).toBeTruthy()
  })
})
