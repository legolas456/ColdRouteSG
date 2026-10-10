import { RAIN } from '../data/sample'
import { hm, windowLabel } from './time'
import type { OptimiseResult, Stop } from './types'

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** One or two sentences explaining why a stop sits where it does. */
export function explainStop(stop: Stop, result: OptimiseResult, names: Record<string, string> = {}): string {
  const rec = result.recommended.byId[stop.id]
  const base = result.baseline.byId[stop.id]
  if (!rec || !base) return ''
  const moved = base.seq !== rec.seq
  const dir = rec.seq < base.seq ? 'earlier' : 'later'
  const from = `from ${ordinal(base.seq)} to ${ordinal(rec.seq)}`
  const order = result.recommended.order
  const prev = order[rec.seq - 2]
  const next = order[rec.seq]
  const between =
    prev && next
      ? `between ${names[prev] ?? prev} and ${names[next] ?? next}`
      : prev
        ? `after ${names[prev] ?? prev}`
        : next
          ? `before ${names[next] ?? next}`
          : ''

  if (base.late > 0 && rec.late === 0) {
    return `Moved ${dir} ${from}. The shortest route arrives at ${hm(base.start)}, ${Math.round(base.late)} min after the window closes.`
  }
  if (base.inRain && !rec.inRain) {
    return `Moved ${dir} ${from} so unloading starts after the ${RAIN.area} showers clear at ${hm(RAIN.end)}. Window ${windowLabel(stop.windowStart, stop.windowEnd)} still met.`
  }
  if (stop.parking.risk > 0.7) {
    return `Nearest carpark is ${stop.parking.distanceKm} km away with ${stop.parking.freePct}% free, so unloading takes longer. Scheduled with ${Math.round(rec.slack)} min of slack.`
  }
  if (stop.cargo === 'PHARMA' && stop.windowEnd - stop.windowStart <= 90 && rec.seq <= 2) {
    return `Pharma with a ${stop.windowEnd - stop.windowStart}-minute window. Served early to protect it.`
  }
  if (!moved) return `Same position as the shortest route; arrives ${hm(rec.arrival)} with ${Math.round(rec.slack)} min to spare.`
  return `Moved ${dir} ${from}, served on the way ${between}. Arrives ${hm(rec.arrival)} with ${Math.round(rec.slack)} min to spare.`
}

export function summarise(result: OptimiseResult, stops: Stop[]) {
  const { recommended: r, baseline: b } = result
  const parts: string[] = []
  const pharma = stops.filter((s) => s.cargo === 'PHARMA')
  if (pharma.every((s) => r.byId[s.id]?.late === 0)) parts.push('Every pharma stop lands inside its window')
  if (b.rainStops > r.rainStops) parts.push(`no unloading during the ${RAIN.area} showers`)
  const extra = Math.round(r.drive - b.drive)
  if (b.lateMinutes > r.lateMinutes && extra > 0) {
    parts.push(`${extra} extra minutes of driving remove ${Math.round(b.lateMinutes - r.lateMinutes)} minutes of lateness`)
  }
  if (!parts.length) return 'The shortest route is already the safest for these stops.'
  const [first, ...rest] = parts
  return `${first}${rest.length ? ', ' + rest.slice(0, -1).join(', ') + (rest.length > 1 ? ' and ' : '') + rest[rest.length - 1] : ''}.`
}
