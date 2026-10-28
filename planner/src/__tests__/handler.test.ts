import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEPARTURE, DEPOT, SAMPLE_STOPS } from '../../../frontend/src/data/sample'

vi.mock('../plan', () => ({ plan: vi.fn() }))
const { handler } = await import('../handler')
const { plan } = await import('../plan')

const RUN = { depot: DEPOT, stops: SAMPLE_STOPS, departure: DEPARTURE, profile: 'balanced' }
const call = async (body: string, isBase64Encoded = false) =>
  (await handler({ body, isBase64Encoded } as APIGatewayProxyEventV2)) as APIGatewayProxyStructuredResultV2 & { body: string }

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

/** What the handler writes to stdout as it is: CloudWatch's embedded metric format. */
const quiet = () => vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

describe('handler', () => {
  it('answers with the plan, and logs its time and cost as metrics', async () => {
    const planned = { result: {}, conditions: {}, legs: {}, roads: { source: 'location', cached: 40, measured: 16, billed: 18 }, elapsedMs: 900 }
    vi.mocked(plan).mockResolvedValue(planned as never)
    const write = quiet()
    const r = await call(JSON.stringify(RUN))
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body)).toEqual(planned)
    expect(vi.mocked(plan).mock.calls[0][0]).toEqual(RUN)
    const lines = write.mock.calls.map(([chunk]) => String(chunk)).filter((l) => l.includes('"_aws"'))
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0])
    expect(line).toMatchObject({ Service: 'planner', PlanMs: 900, RoutesBilled: 18, PairsCached: 40, PairsMeasured: 16, roads: 'location', stops: 7 })
    const [directive] = line._aws.CloudWatchMetrics
    expect(directive.Dimensions).toEqual([['Service']])
    // every metric named in the directive is a number on the line
    for (const m of directive.Metrics) expect(typeof line[m.Name]).toBe('number')
  })

  it('reads a body API Gateway passed on in base64', async () => {
    vi.mocked(plan).mockResolvedValue({ roads: {}, elapsedMs: 1 } as never)
    quiet()
    expect((await call(Buffer.from(JSON.stringify(RUN)).toString('base64'), true)).statusCode).toBe(200)
  })

  it('refuses a run it cannot plan without spending anything on it', async () => {
    const r = await call(JSON.stringify({ ...RUN, stops: [] }))
    expect(r.statusCode).toBe(400)
    expect(JSON.parse(r.body)).toEqual({ detail: 'The run needs 1 to 15 stops.' })
    expect((await call('{"depot":')).statusCode).toBe(400)
    expect(JSON.parse((await call('')).body)).toEqual({ detail: 'The run could not be read as JSON.' })
    expect(plan).not.toHaveBeenCalled()
  })

  it('answers 500 when planning fails, and the console plans in the browser', async () => {
    vi.mocked(plan).mockRejectedValue(new Error('S3 timed out'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await call(JSON.stringify(RUN))
    expect(r.statusCode).toBe(500)
    expect(JSON.parse(r.body)).toEqual({ detail: 'The cloud planner hit an error; its CloudWatch log says why.' })
    expect(error).toHaveBeenCalled()
  })
})
