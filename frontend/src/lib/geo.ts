type Point = { lng: number; lat: number }

/** Great-circle distance in km. */
export function kmBetween(a: Point, b: Point) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function nearest<T extends Point>(items: T[], p: Point): { item: T; km: number } | null {
  let best: T | null = null
  let bestKm = Infinity
  for (const it of items) {
    const km = kmBetween(it, p)
    if (km < bestKm) {
      best = it
      bestKm = km
    }
  }
  return best ? { item: best, km: bestKm } : null
}

/** 0–1: a long walk and a full carpark both slow unloading. Same formula for recorded and live values. */
export const parkingRisk = (distanceKm: number, freePct: number) =>
  Math.min(1, Math.round((Math.min(distanceKm / 1.2, 1) * 0.6 + (1 - freePct / 100) * 0.4) * 100) / 100)
