import 'leaflet/dist/leaflet.css'
import { divIcon, latLngBounds } from 'leaflet'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import type { Coordinate, DeliveryStop, RouteResponse } from '../types'

interface Props {
  depot: Coordinate
  depotName: string
  stops: DeliveryStop[]
  result: RouteResponse | null
  fullScreen?: boolean
}

type LatLngPoint = [number, number]

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function numberIcon(value: string, className: string) {
  return divIcon({
    className: '',
    html: `<div class="map-marker ${className}">${escapeHtml(value)}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

function placeIcon(value: string, name: string, className: string, active = false) {
  return divIcon({
    className: '',
    html: `
      <div class="map-place-marker ${className}${active ? ' active-stop-marker' : ''}">
        <span class="map-marker-number">${escapeHtml(value)}</span>
        <span class="map-marker-label" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      </div>
    `,
    iconSize: [220, 38],
    iconAnchor: [18, 19],
  })
}

function motionIcon(nextSequence: number | null) {
  const label = nextSequence == null ? 'Loop' : `→ ${nextSequence}`
  return divIcon({
    className: '',
    html: `
      <div class="route-motion-wrap">
        <span class="route-motion-pulse"></span>
        <span class="route-motion-core"></span>
        <span class="route-motion-label">${label}</span>
      </div>
    `,
    iconSize: [70, 34],
    iconAnchor: [17, 17],
  })
}

function FitRoute({ points }: { points: LatLngPoint[] }) {
  const map = useMap()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      map.invalidateSize()
      if (points.length > 1) {
        map.fitBounds(latLngBounds(points), { padding: [34, 34], maxZoom: 15 })
      } else if (points.length === 1) {
        map.setView(points[0], 14)
      }
    }, 80)
    return () => window.clearTimeout(timer)
  }, [map, points])

  return null
}

function pointDistance(a: LatLngPoint, b: LatLngPoint) {
  const latScale = 111.32
  const meanLat = ((a[0] + b[0]) / 2) * Math.PI / 180
  const lngScale = 111.32 * Math.cos(meanLat)
  const dy = (b[0] - a[0]) * latScale
  const dx = (b[1] - a[1]) * lngScale
  return Math.sqrt((dx * dx) + (dy * dy))
}

function findNearestGeometryIndex(point: LatLngPoint, geometry: LatLngPoint[], startIndex = 0) {
  if (!geometry.length) return 0
  let bestIndex = Math.min(Math.max(startIndex, 0), geometry.length - 1)
  let bestDistance = Number.POSITIVE_INFINITY

  geometry.forEach((candidate, index) => {
    if (index < startIndex) return
    const distance = pointDistance(point, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })

  return bestIndex
}

function AnimatedRoute({
  geometry,
  orderedStops,
  onActiveSequenceChange,
}: {
  geometry: LatLngPoint[]
  orderedStops: DeliveryStop[]
  onActiveSequenceChange: (sequence: number | null) => void
}) {
  const [frame, setFrame] = useState<{ position: LatLngPoint; index: number } | null>(null)
  const animationFrame = useRef<number | null>(null)

  const routeMetrics = useMemo(() => {
    if (geometry.length < 2) return null

    const cumulative = [0]
    for (let index = 1; index < geometry.length; index += 1) {
      cumulative.push(cumulative[index - 1] + pointDistance(geometry[index - 1], geometry[index]))
    }

    const total = cumulative[cumulative.length - 1]
    let searchStart = 0
    const stopIndices = orderedStops.map((stop, index) => {
      const geometryIndex = findNearestGeometryIndex([stop.lat, stop.lng], geometry, searchStart)
      searchStart = geometryIndex
      return { sequence: index + 1, index: geometryIndex }
    })

    return { cumulative, total, stopIndices }
  }, [geometry, orderedStops])

  useEffect(() => {
    if (!routeMetrics || routeMetrics.total <= 0) {
      setFrame(null)
      return undefined
    }

    const prefersReducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion) {
      setFrame({ position: geometry[0], index: 0 })
      return undefined
    }

    const durationMs = Math.min(30000, Math.max(15000, routeMetrics.total * 1800))
    let startTime: number | null = null
    let previousRender = 0

    const animate = (timestamp: number) => {
      if (startTime == null) startTime = timestamp
      const elapsed = (timestamp - startTime) % durationMs
      const progress = elapsed / durationMs
      const targetDistance = routeMetrics.total * progress

      if (timestamp - previousRender >= 33) {
        previousRender = timestamp

        let upperIndex = 1
        while (
          upperIndex < routeMetrics.cumulative.length - 1
          && routeMetrics.cumulative[upperIndex] < targetDistance
        ) {
          upperIndex += 1
        }

        const lowerIndex = Math.max(0, upperIndex - 1)
        const lowerDistance = routeMetrics.cumulative[lowerIndex]
        const upperDistance = routeMetrics.cumulative[upperIndex]
        const denominator = Math.max(upperDistance - lowerDistance, 0.000001)
        const ratio = Math.min(1, Math.max(0, (targetDistance - lowerDistance) / denominator))
        const lowerPoint = geometry[lowerIndex]
        const upperPoint = geometry[upperIndex]
        const position: LatLngPoint = [
          lowerPoint[0] + ((upperPoint[0] - lowerPoint[0]) * ratio),
          lowerPoint[1] + ((upperPoint[1] - lowerPoint[1]) * ratio),
        ]

        setFrame({ position, index: lowerIndex })
      }

      animationFrame.current = window.requestAnimationFrame(animate)
    }

    animationFrame.current = window.requestAnimationFrame(animate)

    return () => {
      if (animationFrame.current != null) {
        window.cancelAnimationFrame(animationFrame.current)
      }
    }
  }, [geometry, routeMetrics])

  const nextSequence = frame && routeMetrics
    ? routeMetrics.stopIndices.find((stop) => stop.index >= frame.index)?.sequence ?? null
    : null

  useEffect(() => {
    onActiveSequenceChange(nextSequence)
  }, [nextSequence, onActiveSequenceChange])

  if (!frame || !routeMetrics) return null

  const trail = [...geometry.slice(0, frame.index + 1), frame.position]

  return (
    <>
      {trail.length > 1 && (
        <Polyline
          positions={trail}
          weight={6}
          opacity={0.95}
          pathOptions={{ className: 'animated-route-trail' }}
        />
      )}
      <Marker
        position={frame.position}
        icon={motionIcon(nextSequence)}
        interactive={false}
        zIndexOffset={1200}
      />
    </>
  )
}

export function RouteMap({ depot, depotName, stops, result, fullScreen = false }: Props) {
  const [activeSequence, setActiveSequence] = useState<number | null>(null)
  const handleActiveSequenceChange = useCallback((nextSequence: number | null) => {
    setActiveSequence((current) => current === nextSequence ? current : nextSequence)
  }, [])
  const order = useMemo(
    () => result?.ordered_stop_ids ?? stops.map((stop) => stop.id),
    [result?.ordered_stop_ids, stops],
  )
  const sequence = useMemo(
    () => new Map(order.map((id, index) => [id, index + 1])),
    [order],
  )
  const geometry = useMemo<LatLngPoint[]>(
    () => result?.route_geometry?.map(([lng, lat]) => [lat, lng] as LatLngPoint) ?? [],
    [result?.route_geometry],
  )

  const orderedStops = useMemo(() => {
    const byId = new Map(stops.map((stop) => [stop.id, stop]))
    return order.map((id) => byId.get(id)).filter((stop): stop is DeliveryStop => Boolean(stop))
  }, [order, stops])

  const parkingMarkers = useMemo(() => {
    const seenCarparks = new Set<string>()
    return (result?.legs ?? []).filter((leg) => {
      const parking = leg.parking
      if (parking.lat == null || parking.lng == null) return false
      const key = parking.carpark_no ?? `${parking.lat.toFixed(6)}-${parking.lng.toFixed(6)}`
      if (seenCarparks.has(key)) return false
      seenCarparks.add(key)
      return true
    })
  }, [result?.legs])

  const viewportPoints = useMemo<LatLngPoint[]>(() => {
    if (geometry.length > 1) return geometry
    return [
      [depot.lat, depot.lng],
      ...stops.map((stop) => [stop.lat, stop.lng] as LatLngPoint),
      ...parkingMarkers.map((leg) => [leg.parking.lat as number, leg.parking.lng as number] as LatLngPoint),
    ]
  }, [depot.lat, depot.lng, geometry, parkingMarkers, stops])

  return (
    <div className={`route-map ${fullScreen ? 'route-map-fullscreen' : ''}`}>
      {result && (
        <div className="map-legend">
          <span className="legend-dot parking-dot">P</span> Nearest parking
          <span className="map-legend-divider"></span>
          <span className="route-animation-legend"><span className="route-animation-dot"></span> Route animation</span>
        </div>
      )}
      <MapContainer center={[depot.lat, depot.lng]} zoom={11} scrollWheelZoom touchZoom doubleClickZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution={'<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> &copy; contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>'}
          url="https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png"
          minZoom={11}
          maxZoom={19}
        />
        <FitRoute points={viewportPoints} />
        <Marker position={[depot.lat, depot.lng]} icon={placeIcon('D', depotName, 'depot-place-marker')}>
          <Popup><strong>{depotName}</strong><br />Current starting point</Popup>
        </Marker>
        {stops.map((stop) => (
          <Marker
            key={stop.id}
            position={[stop.lat, stop.lng]}
            icon={placeIcon(
              String(sequence.get(stop.id) ?? '•'),
              stop.name,
              'stop-place-marker',
              sequence.get(stop.id) === activeSequence,
            )}
          >
            <Popup>
              <strong>{stop.name}</strong><br />
              Cold-chain priority: {stop.cold_chain_priority}
            </Popup>
          </Marker>
        ))}
        {parkingMarkers.map((leg) => (
          <Marker
            key={`parking-${leg.parking.carpark_no ?? leg.stop_id}`}
            position={[leg.parking.lat as number, leg.parking.lng as number]}
            icon={numberIcon('P', 'parking-marker')}
          >
            <Popup>
              <strong>{leg.parking.carpark_no ?? 'Nearest carpark'}</strong><br />
              {leg.parking.address ?? 'Address unavailable'}<br />
              Nearest to: {leg.stop_name}<br />
              {leg.parking.available_lots != null && leg.parking.total_lots != null
                ? `${leg.parking.available_lots} / ${leg.parking.total_lots} lots available`
                : 'Lot availability unavailable'}
              {leg.parking.distance_m != null && <><br />{Math.round(leg.parking.distance_m)} m from delivery</>}
            </Popup>
          </Marker>
        ))}
        {geometry.length > 1 && (
          <>
            <Polyline
              positions={geometry}
              weight={5}
              opacity={0.34}
              pathOptions={{ className: 'route-base-line' }}
            />
            <AnimatedRoute
              geometry={geometry}
              orderedStops={orderedStops}
              onActiveSequenceChange={handleActiveSequenceChange}
            />
          </>
        )}
      </MapContainer>
    </div>
  )
}
