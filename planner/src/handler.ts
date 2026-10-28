// AWS Lambda entry: POST /api/plan behind API Gateway, which has already
// checked the user's Cognito token. Planning in the cloud is for signed-in
// users, since every new pair of stops costs a Location Service call.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { GeoRoutesClient } from '@aws-sdk/client-geo-routes'
import { S3Client } from '@aws-sdk/client-s3'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { RoadsUsed } from '../../frontend/src/lib/types'
import { readInputs, readTypical, type Sources } from './inputs'
import { plan } from './plan'
import { isBadRequest, parseRequest } from './request'
import type { RoadClients } from './roads'

const env = process.env
const sources: Sources = { s3: new S3Client({}), bucket: env.TRAFFIC_BUCKET ?? '', trafficKey: env.TRAFFIC_KEY ?? 'traffic/speed-grid.json' }
// without the cache table, drive times come from OSRM, as in the console
const roads: RoadClients | null = env.DRIVE_TIMES_TABLE
  ? { geo: new GeoRoutesClient({ region: env.ROUTING_REGION || 'ap-southeast-2' }), db: new DynamoDBClient({}), table: env.DRIVE_TIMES_TABLE }
  : null

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/**
 * One log line per plan in CloudWatch's embedded metric format, from which
 * CloudWatch makes the dashboard's metrics: how long plans take and how many
 * routes Location Service bills for them. Written to stdout as it is, since
 * console.log would put Lambda's prefix in front of the JSON.
 */
export function logPlan(stops: number, roads: RoadsUsed, elapsedMs: number, now = Date.now()) {
  const metrics = {
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: env.METRICS_NAMESPACE || 'ColdRoute',
          Dimensions: [['Service']],
          Metrics: [
            { Name: 'PlanMs', Unit: 'Milliseconds' },
            { Name: 'RoutesBilled', Unit: 'Count' },
            { Name: 'PairsCached', Unit: 'Count' },
          ],
        },
      ],
    },
    Service: 'planner',
    PlanMs: elapsedMs,
    RoutesBilled: roads.billed,
    PairsCached: roads.cached,
    PairsMeasured: roads.measured,
    roads: roads.source,
    stops,
  }
  process.stdout.write(`${JSON.stringify(metrics)}\n`)
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  let request
  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '')
    request = parseRequest(JSON.parse(body))
  } catch (e) {
    return json(400, { detail: isBadRequest(e) ? e.message : 'The run could not be read as JSON.' })
  }
  try {
    const planned = await plan(request, { inputs: () => readInputs(sources), typical: (d) => readTypical(sources, d), roads })
    logPlan(request.stops.length, planned.roads, planned.elapsedMs)
    return json(200, planned)
  } catch (e) {
    console.error('Planning failed', e)
    return json(500, { detail: 'The cloud planner hit an error; its CloudWatch log says why.' })
  }
}
