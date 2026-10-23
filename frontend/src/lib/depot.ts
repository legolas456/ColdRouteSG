import type { Place } from './places'
import type { Depot } from './types'

/** Keep custom depots separate from the bundled Jurong road matrix. */
export function depotFromPlace(place: Place): Depot {
  return {
    id: `D:${place.lng.toFixed(6)},${place.lat.toFixed(6)}`,
    name: place.name,
    address: place.address,
    lng: place.lng,
    lat: place.lat,
  }
}

/** Ignore stale or malformed browser storage rather than planning from invalid coordinates. */
export function validDepot(value: unknown, sample: Depot): value is Depot {
  if (!value || typeof value !== 'object') return false
  const depot = value as Record<string, unknown>
  if (
    typeof depot.lng !== 'number' || typeof depot.lat !== 'number' ||
    !Number.isFinite(depot.lng) || !Number.isFinite(depot.lat) ||
    depot.lng <= 103.6 || depot.lng >= 104.1 ||
    depot.lat <= 1.15 || depot.lat >= 1.48
  ) return false
  const matchesSample = depot.id === sample.id && depot.lng === sample.lng && depot.lat === sample.lat
  const matchesCustom = depot.id === `D:${depot.lng.toFixed(6)},${depot.lat.toFixed(6)}`
  return (
    (matchesSample || matchesCustom) &&
    typeof depot.name === 'string' && depot.name.trim().length > 0 &&
    typeof depot.address === 'string'
  )
}
