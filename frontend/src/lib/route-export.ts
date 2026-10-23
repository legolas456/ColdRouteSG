import type { OptimiseResult, Plan, Stop } from './types'

export type ExportView = 'coldroute' | 'baseline' | 'compare'

interface ExportData {
  source: 'live' | 'mixed' | 'recorded'
  at: number
}

const clock = (minutes: number) => {
  const rounded = Math.round(minutes)
  const day = Math.floor(rounded / 1440)
  const time = ((rounded % 1440) + 1440) % 1440
  const label = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`
  return day > 0 ? `${label} (+${day} day)` : label
}

// Quoting also prevents spreadsheet software from treating user-entered names as formulas.
const cell = (value: string | number | boolean) => {
  const raw = String(value)
  const safe = /^[\s]*[=+@\-]/.test(raw) && typeof value === 'string' ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

const HEADERS = [
  'plan', 'profile', 'data_source', 'data_time', 'departure', 'sequence',
  'stop_id', 'stop_name', 'address', 'latitude', 'longitude', 'cargo',
  'window_start', 'window_end', 'arrival', 'service_start', 'finish',
  'service_minutes', 'leg_drive_minutes', 'late_minutes', 'unloads_in_rain',
  'parking_risk_proxy', 'traffic_risk_proxy', 'cold_chain_exposure_proxy_minutes',
]

export function routeCsv(
  result: OptimiseResult,
  stops: Record<string, Stop>,
  view: ExportView,
  profile: string,
  departure: number,
  data: ExportData,
): string {
  const plans: Array<[string, Plan]> = view === 'compare'
    ? [['ColdRoute', result.recommended], ['Shortest route', result.baseline]]
    : view === 'baseline'
      ? [['Shortest route', result.baseline]]
      : [['ColdRoute', result.recommended]]

  const rows = plans.flatMap(([name, plan]) => plan.rows.map((row) => {
    const stop = stops[row.id]
    if (!stop) throw new Error(`Missing stop for exported route: ${row.id}`)
    return [
      name, profile, data.source, clock(data.at), clock(departure), row.seq,
      row.id, stop.name, stop.address, stop.lat, stop.lng, stop.cargo,
      clock(stop.windowStart), clock(stop.windowEnd), clock(row.arrival),
      clock(row.start), clock(row.finish), stop.service, row.legMinutes,
      row.late, row.inRain, stop.parking.risk, stop.trafficRisk, row.exposure,
    ].map(cell).join(',')
  }))

  return [HEADERS.map(cell).join(','), ...rows].join('\r\n') + '\r\n'
}
