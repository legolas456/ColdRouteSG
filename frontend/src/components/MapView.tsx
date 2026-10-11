import clsx from 'clsx'
import { Check, LocateFixed, Minus, Plus } from 'lucide-react'
import { GeoJSONSource, LngLatBounds, Map as MapLibre, Marker, setWorkerUrl, type ExpressionSpecification, type LayerSpecification, type StyleSpecification } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import sgMask from '../data/sg-mask.json'
import { legGeometry, pathFor } from '../lib/optimizer'
import { hm } from '../lib/time'
import type { Depot, OptimiseResult, RainCell, Stop } from '../lib/types'
import type { MapPalette } from '../lib/themes'
import type { View } from './ResultsPanel'

// The ESM build resolves its worker relative to import.meta.url, which breaks
// once Vite pre-bundles or hashes the library. Point it at the shipped file.
setWorkerUrl(workerUrl)

export type { MapPalette }

/** The camera never leaves Singapore: panning and zooming out stop here. */
export const SG_BOUNDS: [[number, number], [number, number]] = [
  [103.4, 0.9],
  [104.25, 1.72],
]

type Padding = { top: number; bottom: number; left: number; right: number }

/** Shrink padding proportionally when the map is too small to honour it. */
function clampPadding(map: MapLibre, p: Padding): Padding {
  const { clientWidth: w, clientHeight: h } = map.getContainer()
  const axis = (a: number, b: number, size: number): [number, number] => {
    const room = Math.max(0, size - 140)
    if (a + b <= room) return [a, b]
    const k = room / (a + b)
    return [Math.floor(a * k), Math.floor(b * k)]
  }
  const [left, right] = axis(p.left, p.right, w)
  const [top, bottom] = axis(p.top, p.bottom, h)
  return { top, bottom, left, right }
}
export interface Layers {
  rain: boolean
  parking: boolean
  traffic: boolean
  baseline: boolean
}

const STYLE: Record<MapPalette['base'], string> = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
}

const EMPTY_LINE: GeoJSON.Feature<GeoJSON.LineString> = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: [] },
}

/**
 * Repaint the Carto vector style into a quiet, lightly tinted basemap. Runs on the
 * style JSON before MapLibre sees it, so there is no flash of the original
 * colours and no paint transitions on load.
 */
function tintedSpec(style: StyleSpecification, c: MapPalette): StyleSpecification {
  const layers = style.layers.map((layer) => {
    const id = layer.id
    const paint: Record<string, unknown> = { ...('paint' in layer ? layer.paint : {}) }
    const layout: Record<string, unknown> = { ...('layout' in layer ? layer.layout : {}) }
    if (layer.type === 'background') paint['background-color'] = c.bg
    else if (layer.type === 'fill') {
      if (/water/.test(id)) paint['fill-color'] = c.water
      else if (/park|wood|grass|forest|nature|cemetery|golf|pitch/.test(id)) paint['fill-color'] = c.park
      else if (/building/.test(id)) {
        paint['fill-color'] = c.building
        paint['fill-outline-color'] = c.casing
      } else paint['fill-color'] = c.land
    } else if (layer.type === 'line') {
      if (/water|river/.test(id)) paint['line-color'] = c.waterLine
      else if (/boundary/.test(id)) paint['line-color'] = c.boundary
      else if (/case|casing|rail/.test(id)) paint['line-color'] = c.casing
      else paint['line-color'] = c.road
    } else if (layer.type === 'symbol') {
      if (/poi|housenumber|aeroway|rail|transit|shield/.test(id)) layout.visibility = 'none'
      else {
        paint['text-color'] = /water/.test(id) ? c.waterLabel : c.label
        paint['text-halo-color'] = c.halo
        paint['icon-opacity'] = 0
        if (/country|state|city/.test(id)) paint['text-opacity'] = 0.55
      }
    }
    return { ...layer, paint, layout } as LayerSpecification
  })
  return { ...style, transition: { duration: 0, delay: 0 }, layers }
}

const blankStyle = (c: MapPalette): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': c.bg } }],
})

function applyBasemap(map: MapLibre, c: MapPalette) {
  map.setStyle(STYLE[c.base], { diff: false, transformStyle: (_prev, next) => tintedSpec(next, c) })
}

/** Tile size of the rain hatch in CSS px. */
const HATCH = 12

/** One tile of diagonal rain. `phase` (0 to HATCH) slides the lines down the slope. */
function hatchImage(color: string, phase = 0) {
  const size = HATCH
  const ratio = 2
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size * ratio
  const ctx = canvas.getContext('2d')!
  ctx.scale(ratio, ratio)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.4
  ctx.beginPath()
  for (const o of [-2 * size, -size, 0, size]) {
    ctx.moveTo(o + phase, size)
    ctx.lineTo(o + phase + size, 0)
  }
  ctx.stroke()
  const data = ctx.getImageData(0, 0, size * ratio, size * ratio)
  return { width: data.width, height: data.height, data: new Uint8Array(data.data.buffer) }
}

function rainPolygon(cell: RainCell, i: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lng, lat] = cell.center
  const ring: [number, number][] = []
  for (let k = 0; k <= 72; k++) {
    const t = (k / 72) * Math.PI * 2
    const r = cell.radiusKm * (1 + 0.1 * Math.sin(3 * t + 0.6 + i * 1.7) + 0.06 * Math.cos(5 * t + i))
    ring.push([lng + (r / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(t), lat + (r / 110.574) * Math.sin(t)])
  }
  return { type: 'Feature', properties: { heavy: cell.heavy }, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/** Heavy or thundery cells are drawn stronger than light rain. */
const rainCells = (rain: RainCell[]): GeoJSON.FeatureCollection<GeoJSON.Polygon> => ({
  type: 'FeatureCollection',
  features: rain.map(rainPolygon),
})

const HEAVY = ['==', ['get', 'heavy'], true] as ExpressionSpecification

function addOverlays(map: MapLibre, c: MapPalette, rain: RainCell[]) {
  // Carto puts a few water labels before the road layers; anchor overlays above
  // the last road/building layer so white road fills never cover the route.
  const styleLayers = map.getStyle().layers ?? []
  let lastGeometry = -1
  styleLayers.forEach((l, i) => {
    if (l.type === 'line' || l.type === 'fill' || l.type === 'fill-extrusion') lastGeometry = i
  })
  const before = styleLayers.slice(lastGeometry + 1).find((l) => l.type === 'symbol')?.id
  if (map.hasImage('hatch')) map.removeImage('hatch')
  map.addImage('hatch', hatchImage(c.rainHatch), { pixelRatio: 2 })

  map.addSource('rain', { type: 'geojson', data: rainCells(rain) })
  const dark = c.base === 'dark'
  map.addLayer(
    {
      id: 'rain-tint',
      type: 'fill',
      source: 'rain',
      paint: { 'fill-color': c.rain, 'fill-opacity': ['case', HEAVY, dark ? 0.2 : 0.15, dark ? 0.13 : 0.09] as ExpressionSpecification },
    },
    before,
  )
  map.addLayer(
    {
      id: 'rain-fill',
      type: 'fill',
      source: 'rain',
      paint: { 'fill-pattern': 'hatch', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.95, 14, 0.4] },
    },
    before,
  )
  map.addLayer(
    { id: 'rain-glow', type: 'line', source: 'rain', paint: { 'line-color': c.rain, 'line-opacity': 0.2, 'line-width': 7, 'line-blur': 5 } },
    before,
  )
  map.addLayer(
    {
      id: 'rain-line',
      type: 'line',
      source: 'rain',
      paint: {
        'line-color': c.rain,
        'line-opacity': ['case', HEAVY, 0.9, 0.7] as ExpressionSpecification,
        'line-width': ['case', HEAVY, 1.8, 1.3] as ExpressionSpecification,
      },
    },
    before,
  )

  for (const id of ['walk', 'traffic', 'route-secondary']) {
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  // lineMetrics enables line-progress, which drives the reveal animation
  map.addSource('route-primary', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } })
  map.addLayer(
    {
      id: 'walk',
      type: 'line',
      source: 'walk',
      paint: { 'line-color': c.walk, 'line-width': 1.2, 'line-dasharray': [1, 2], 'line-opacity': 0.7 },
    },
    before,
  )
  map.addLayer(
    {
      id: 'route-secondary',
      type: 'line',
      source: 'route-secondary',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': c.baseline, 'line-width': 2.2, 'line-dasharray': [2, 2] },
    },
    before,
  )
  map.addLayer(
    {
      id: 'route-casing',
      type: 'line',
      source: 'route-primary',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-gradient': reveal(c.routeCasing, 1), 'line-width': 7.5 },
    },
    before,
  )
  map.addLayer(
    {
      id: 'route-primary',
      type: 'line',
      source: 'route-primary',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-gradient': reveal(c.route, 1), 'line-width': 3.6 },
    },
    before,
  )
  // Jams sit on the route itself, like a ride-hailing app: a red stretch of the line
  map.addLayer(
    {
      id: 'traffic-casing',
      type: 'line',
      source: 'traffic',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.routeCasing, 'line-width': 8.5 },
    },
    before,
  )
  map.addLayer(
    {
      id: 'traffic',
      type: 'line',
      source: 'traffic',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.traffic, 'line-width': 4.8 },
    },
    before,
  )

  // Dim Johor and the Riau islands so Singapore stays in focus. Drawn last, so
  // it also fades their place labels; Singapore itself is a hole in the mask.
  map.addSource('outside-sg', { type: 'geojson', data: sgMask as unknown as GeoJSON.Feature })
  map.addLayer({
    id: 'outside-sg',
    type: 'fill',
    source: 'outside-sg',
    paint: { 'fill-color': c.bg, 'fill-opacity': c.base === 'dark' ? 0.72 : 0.68 },
  })
  map.addLayer({
    id: 'outside-sg-edge',
    type: 'line',
    source: 'outside-sg',
    paint: { 'line-color': c.boundary, 'line-width': 1, 'line-dasharray': [4, 3] },
  })
}

const kmBetween = ([x1, y1]: [number, number], [x2, y2]: [number, number]) =>
  Math.hypot((x2 - x1) * Math.cos((y1 * Math.PI) / 180), y2 - y1) * 111.2

/** The part of a line between two fractions of its length (by distance, not by vertex). */
function sliceByDistance(line: [number, number][], from: number, to: number) {
  const d = [0]
  for (let i = 1; i < line.length; i++) d.push(d[i - 1] + kmBetween(line[i - 1], line[i]))
  const total = d[d.length - 1]
  const coords = line.filter((_, i) => d[i] >= from * total && d[i] <= to * total)
  return { coords, mid: coords[Math.floor(coords.length / 2)] ?? line[0], km: total * (to - from) }
}

/** Gradient that paints the first `p` of a line and leaves the rest transparent. */
function reveal(color: string, p: number) {
  return ['step', ['line-progress'], color, Math.min(1, Math.max(0.0001, p)), 'rgba(0,0,0,0)'] as ExpressionSpecification
}

function markerEl(html: string, onClick?: () => void) {
  const el = document.createElement('div')
  el.innerHTML = html
  if (onClick) {
    el.style.cursor = 'pointer'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick()
    })
  }
  return el
}

interface Props {
  palette: MapPalette
  depot: Depot
  stops: Stop[]
  /** rain cells to draw: the plan's once optimised, the current ones in the draft */
  rain: RainCell[]
  result: OptimiseResult | null
  view: View
  phase: 'draft' | 'optimising' | 'optimised'
  selectedId: string | null
  onSelect: (id: string | null) => void
  layers: Layers
  setLayers: (l: Layers) => void
  insetLeft?: number
  insetBottom?: number
  cardOpen?: boolean
  /** Phone layout: no legend or zoom buttons, chips scroll sideways. */
  compact?: boolean
  children?: ReactNode
}

export function MapView(props: Props) {
  const { palette, depot, stops, rain, result, view, phase, selectedId, onSelect, layers, setLayers } = props
  const insetLeft = props.insetLeft ?? 0
  const insetBottom = props.insetBottom ?? 0
  const compact = !!props.compact
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibre | null>(null)
  const themeRef = useRef(palette)
  const rainRef = useRef(rain)
  rainRef.current = rain
  const markersRef = useRef<Marker[]>([])
  const animRef = useRef(0)
  const revealTimer = useRef(0)
  const [styleVersion, setStyleVersion] = useState(0)
  const stopById = useMemo(() => Object.fromEntries(stops.map((s) => [s.id, s])), [stops])

  const padding = useMemo<Padding>(
    () =>
      compact
        ? { top: 64, bottom: 24 + insetBottom, left: 28 + insetLeft, right: 28 }
        : { top: 72, bottom: 56 + insetBottom, left: 56 + insetLeft, right: props.cardOpen ? 420 : 72 },
    [insetLeft, insetBottom, props.cardOpen, compact],
  )
  // true once the user pans or zooms; container resizes then keep their view
  const userMoved = useRef(false)

  // Spread markers that sit within ~1.6 km of each other so both stay legible.
  const offsets = useMemo(() => {
    const out: Record<string, [number, number]> = {}
    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const a = stops[i]
        const b = stops[j]
        const dx = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180)
        const dy = b.lat - a.lat
        const km = Math.hypot(dx, dy) * 111.2
        if (km > 1.6) continue
        const len = Math.hypot(dx, dy) || 1
        const ux = dx / len
        const uy = -dy / len
        out[a.id] = [-ux * 13, -uy * 13]
        out[b.id] = [ux * 13, uy * 13]
      }
    }
    return out
  }, [stops])

  // init
  useEffect(() => {
    if (!ref.current) return
    const map = new MapLibre({
      container: ref.current,
      style: blankStyle(themeRef.current),
      center: [103.82, 1.352],
      zoom: 11,
      minZoom: 9.5,
      maxBounds: SG_BOUNDS,
      renderWorldCopies: false,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 0,
    })
    map.touchZoomRotate.disableRotation()
    map.on('error', (e) => console.error('[map]', e.error?.message ?? e))
    let firstStyle = true
    map.on('style.load', () => {
      // the blank placeholder style also fires style.load; wait for the basemap
      if (!Object.keys(map.getStyle().sources ?? {}).length) return
      addOverlays(map, themeRef.current, rainRef.current)
      if (firstStyle) {
        firstStyle = false
        fitRef.current(0)
        // keep credits one click away behind the (i) button, so they never cover labels
        // (MapLibre opens them again while the first tiles load, so wait for idle)
        map.once('idle', () => map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'))
      }
      setStyleVersion((v) => v + 1)
    })
    map.on('click', () => onSelectRef.current(null))
    map.on('movestart', (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) userMoved.current = true
    })
    // Re-frame the run when the container changes size (panel drag or collapse,
    // window resize, bottom sheet), unless the user has moved the map.
    let resizeTimer = 0
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        if (!userMoved.current && !selectedRef.current) fitRef.current(250)
      }, 140)
    })
    ro.observe(ref.current)
    mapRef.current = map
    applyBasemap(map, themeRef.current)
    return () => {
      clearTimeout(resizeTimer)
      ro.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  // live rain changes between refreshes and runs
  useEffect(() => {
    const src = mapRef.current?.getSource('rain') as GeoJSONSource | undefined
    if (styleVersion && src) src.setData(rainCells(rain))
  }, [rain, styleVersion])

  // With live data there can be a dozen cells: label only those over this
  // run's stops, one per kind of rain and period (the cell with most stops),
  // and never two within ~3 km.
  const labelled = useMemo(() => {
    const count = (c: RainCell) => stops.filter((s) => s.area === c.area).length
    const pool = (rain.length <= 3 ? [...rain] : rain.filter((c) => count(c) > 0)).sort(
      (a, b) => Number(b.heavy) - Number(a.heavy) || count(b) - count(a),
    )
    const out: RainCell[] = []
    const kinds = new Set<string>()
    for (const c of pool) {
      if (out.length >= 4) break
      const kind = `${c.label}|${c.start}|${c.end}`
      if (rain.length > 3 && kinds.has(kind)) continue
      if (out.some((o) => kmBetween(o.center, c.center) < 3)) continue
      kinds.add(kind)
      out.push(c)
    }
    return out
  }, [rain, stops])

  // theme swap
  useEffect(() => {
    if (themeRef.current === palette) return
    themeRef.current = palette
    if (mapRef.current) applyBasemap(mapRef.current, palette)
  }, [palette])

  const primaryPlan = result ? (view === 'baseline' ? result.baseline : result.recommended) : null
  const secondaryPlan = result
    ? view === 'compare' || layers.baseline
      ? view === 'baseline'
        ? result.recommended
        : result.baseline
      : null
    : null

  // Heavy traffic on the shown plan: the slow stretch of each approach into a
  // congested stop (LTA speed bands in production)
  const jams = useMemo(() => {
    const out: Array<{ id: string; coords: [number, number][]; mid: [number, number]; km: number }> = []
    if (!primaryPlan) return out
    let prev: { id: string; lng: number; lat: number } = depot
    for (const id of primaryPlan.order) {
      const s = stopById[id]
      if (s.trafficRisk >= 0.5) {
        // 12% of the approach at risk 0.5, up to 18% at 0.6, ending just before the stop
        const span = 0.12 + (s.trafficRisk - 0.5) * 0.6
        const seg = sliceByDistance(legGeometry(prev, s), 0.88 - span, 0.88)
        if (seg.coords.length > 1) out.push({ id, ...seg })
      }
      prev = s
    }
    return out
  }, [primaryPlan, depot, stopById])

  // lines + overlay visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion || !map.getSource('route-primary')) return
    const vis = (id: string, on: boolean) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    for (const id of ['rain-tint', 'rain-fill', 'rain-glow', 'rain-line']) vis(id, layers.rain)
    vis('walk', layers.parking)
    vis('traffic', layers.traffic && !!primaryPlan)
    vis('traffic-casing', layers.traffic && !!primaryPlan)

    const primary = map.getSource('route-primary') as GeoJSONSource
    const secondary = map.getSource('route-secondary') as GeoJSONSource
    const coords = primaryPlan ? pathFor(depot, primaryPlan.order, stopById) : []
    secondary.setData(
      secondaryPlan ? { ...EMPTY_LINE, geometry: { type: 'LineString', coordinates: pathFor(depot, secondaryPlan.order, stopById) } } : EMPTY_LINE,
    )

    // walking links from carpark to door
    ;(map.getSource('walk') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: stops
        .filter((s) => s.parking.distanceKm >= 0.3)
        .map((s) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [[s.parking.lng, s.parking.lat], [s.lng, s.lat]] },
        })),
    })

    // jams appear once the route has been drawn through them
    const traffic = map.getSource('traffic') as GeoJSONSource
    const showJams = () =>
      traffic.setData({
        type: 'FeatureCollection',
        features: jams.map((j) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: j.coords } })),
      })
    traffic.setData({ type: 'FeatureCollection', features: [] })

    cancelAnimationFrame(animRef.current)
    clearTimeout(revealTimer.current)
    if (!coords.length) {
      primary.setData(EMPTY_LINE)
      return
    }
    primary.setData({ ...EMPTY_LINE, geometry: { type: 'LineString', coordinates: coords } })
    const c = themeRef.current
    // the shortest route is "not ours": draw it in neutral, ColdRoute in brand
    const lineColor = view === 'baseline' ? c.walk : c.route
    map.setPaintProperty('route-secondary', 'line-color', view === 'baseline' ? c.route : c.baseline)
    const paint = (p: number) => {
      map.setPaintProperty('route-primary', 'line-gradient', reveal(lineColor, p))
      map.setPaintProperty('route-casing', 'line-gradient', reveal(c.routeCasing, p))
    }
    const t0 = performance.now()
    const total = 900
    const frame = (now: number) => {
      const p = Math.min(1, (now - t0) / total)
      paint(1 - Math.pow(1 - p, 3))
      if (p < 1) animRef.current = requestAnimationFrame(frame)
    }
    paint(0)
    animRef.current = requestAnimationFrame(frame)
    // rAF is throttled in background tabs and some embedded browsers: always land on the full route
    revealTimer.current = window.setTimeout(() => {
      cancelAnimationFrame(animRef.current)
      paint(1)
      showJams()
    }, total + 200)
  }, [styleVersion, primaryPlan, secondaryPlan, layers, depot, stopById, stops, view, jams])

  // Rain drifts slowly down the hatch: 8 frames on a loop, about 8 fps. Quiet
  // enough to read as weather, not as an alert. Off for reduced motion.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion || !layers.rain) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const frames = Array.from({ length: 8 }, (_, i) => hatchImage(palette.rainHatch, (i * HATCH) / 8))
    let i = 0
    const timer = window.setInterval(() => {
      if (!map.hasImage('hatch')) return
      i = (i + 1) % frames.length
      map.updateImage('hatch', frames[i])
    }, 125)
    return () => clearInterval(timer)
  }, [styleVersion, layers.rain, palette])

  // markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion) return
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    const add = (
      el: HTMLElement,
      lngLat: [number, number],
      z = 1,
      offset: [number, number] = [0, 0],
      anchor: 'center' | 'top-left' | 'bottom' | 'top' | 'bottom-right' = 'center',
    ) => {
      el.style.zIndex = String(z)
      markersRef.current.push(new Marker({ element: el, anchor, offset }).setLngLat(lngLat).addTo(map))
    }

    // rain labels, attached to each cell's rim. Heavy cells hang theirs off the
    // south-east rim, light ones sit on the north rim; when a stop is right
    // there, try the other sides so the label never covers a stop.
    if (layers.rain) {
      type Spot = { dx: number; dy: number; anchor: 'top-left' | 'bottom' | 'top' | 'bottom-right'; offset: [number, number] }
      const SE: Spot = { dx: 0.72, dy: -0.72, anchor: 'top-left', offset: [4, 4] }
      const N: Spot = { dx: 0, dy: 0.95, anchor: 'bottom', offset: [0, -4] }
      const S: Spot = { dx: 0, dy: -0.95, anchor: 'top', offset: [0, 4] }
      const NW: Spot = { dx: -0.72, dy: 0.72, anchor: 'bottom-right', offset: [-4, -4] }
      const places: [number, number][] = [[depot.lng, depot.lat], ...stops.map((s): [number, number] => [s.lng, s.lat])]
      labelled.forEach((cell) => {
        const heavy = cell.heavy
        const kx = 1 / (111.32 * Math.cos((cell.center[1] * Math.PI) / 180))
        const ky = 1 / 110.574
        const at = (s: Spot): [number, number] => [cell.center[0] + cell.radiusKm * s.dx * kx, cell.center[1] + cell.radiusKm * s.dy * ky]
        const options = heavy ? [SE, S, N, NW] : [N, S, NW, SE]
        const spot = options.find((s) => !places.some((p) => kmBetween(p, at(s)) < 1.2)) ?? options[0]
        add(
          markerEl(
            `<div class="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-panel ${heavy ? 'px-2.5 py-1 text-[11px]' : 'px-2 py-[3px] text-[10.5px]'} text-fg shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--rain)_65%,transparent),0_2px_6px_rgba(16,24,40,0.12)]">
              <svg class="text-rain" width="${heavy ? 13 : 11}" height="${heavy ? 13 : 11}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/><path d="M8 19v2M8 13v2M16 19v2M16 13v2M12 21v2M12 15v2"/></svg>
              <span class="font-semibold">${cell.label}</span>${compact ? '' : `<span class="num text-fg-2">${hm(cell.start)}–${hm(cell.end)}</span>`}</div>`,
          ),
          at(spot),
          2,
          spot.offset,
          spot.anchor,
        )
      })
    }

    // heavy-traffic tags: only on jams long enough to matter, never on top of a
    // stop, and one per area so they never stack
    // (phones: the red stretches alone, tags would crowd the small map)
    if (layers.traffic && phase === 'optimised' && !compact) {
      const tagged: [number, number][] = []
      const places: [number, number][] = [[depot.lng, depot.lat], ...stops.map((s): [number, number] => [s.lng, s.lat])]
      for (const j of jams) {
        if (j.km < 1) continue
        if (places.some((p) => kmBetween(p, j.mid) < 1.5)) continue
        if (tagged.some((t) => kmBetween(t, j.mid) < 2.5)) continue
        tagged.push(j.mid)
        add(
          markerEl(
            `<div class="flex items-center gap-1 whitespace-nowrap rounded-full bg-bad px-1.5 py-[2px] text-[10.5px] font-semibold text-white shadow-[0_0_0_2px_var(--bg-panel),0_2px_6px_rgba(16,24,40,0.18)]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v-3l2-6h12l2 6v3z"/><path d="M6 16v3M18 16v3M4 13h16"/></svg>
              Heavy traffic</div>`,
          ),
          j.mid,
          4,
          [0, -16],
        )
      }
    }

    // carparks
    if (layers.parking) {
      for (const s of stops) {
        const risky = s.parking.risk >= 0.7
        const p = s.parking
        const tip = `${p.code ? `${p.code} · ` : ''}${p.name} · ${p.live ? `${p.live.free}/${p.live.total} lots free` : `${p.freePct}% free`} · ${p.distanceKm} km from ${s.short}`
        add(
          markerEl(
            `<div title="${tip.replace(/"/g, '&quot;')}" class="relative flex size-[18px] items-center justify-center rounded-[5px] bg-panel num text-[9.5px] font-bold text-fg-2 shadow-[inset_0_0_0_1.5px_var(--text-3)]">P
              ${risky ? `<div class="absolute left-[24px] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-[5px] bg-panel px-1.5 py-0.5 text-[10.5px] text-fg-2 shadow-card"><span class="num">${s.parking.distanceKm} km</span> walk · <span class="num">${s.parking.freePct}%</span> free</div>` : ''}
            </div>`,
          ),
          [s.parking.lng, s.parking.lat],
          3,
        )
      }
    }

    // depot
    add(
      markerEl(
        `<div class="relative flex size-[28px] items-center justify-center rounded-[8px] bg-ink text-on-ink shadow-[0_0_0_3px_var(--bg-panel)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-6h6v6"/></svg>
          <div class="absolute left-[36px] top-1/2 -translate-y-1/2 whitespace-nowrap text-[11.5px] font-semibold text-fg [text-shadow:0_0_3px_var(--bg-main),0_0_3px_var(--bg-main)]">${depot.name}</div>
        </div>`,
      ),
      [depot.lng, depot.lat],
      5,
    )

    // stops
    const plan = primaryPlan
    stops.forEach((s, i) => {
      const row = plan?.byId[s.id]
      const seq = row ? row.seq : i + 1
      const selected = selectedId === s.id
      const risk = !!result && view !== 'baseline' && result.highestRiskId === s.id
      const late = !!row && row.late > 0
      const solid = phase === 'optimised' && view !== 'baseline'
      const size = selected ? 32 : 26
      const ring = selected ? 'shadow-[0_0_0_3px_var(--bg-panel),0_0_0_5px_var(--brand)]' : 'shadow-[0_0_0_3px_var(--bg-panel),0_1px_3px_3px_rgba(16,24,40,0.12)]'
      const body = solid
        ? 'bg-brand text-on-brand'
        : view === 'baseline' && phase === 'optimised'
          ? 'bg-panel text-fg-2 shadow-[inset_0_0_0_1.75px_var(--text-3)]'
          : 'bg-panel text-brand-fg shadow-[inset_0_0_0_1.75px_var(--brand)]'
      const offset = offsets[s.id] ?? [0, 0]
      const labelSide = offset[0] < -2 ? `right:${size + 7}px` : `left:${size + 7}px`
      add(
        markerEl(
          `<div class="relative transition-transform duration-150 hover:scale-110" style="width:${size}px;height:${size}px">
            ${risk ? '<span class="absolute inset-0 rounded-full border-2 border-bad animate-pulse-ring"></span>' : ''}
            <span class="absolute inset-0 rounded-full ${ring}"></span>
            <span class="num absolute inset-0 flex items-center justify-center rounded-full ${body} text-[11.5px] font-semibold">${seq}</span>
            ${late ? '<span class="absolute -right-0.5 -top-0.5 size-[10px] rounded-full bg-bad shadow-[0_0_0_2px_var(--bg-panel)]"></span>' : ''}
            <div class="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] ${selected ? 'font-semibold text-fg' : 'font-medium text-fg-2'} [text-shadow:0_0_3px_var(--bg-main),0_0_3px_var(--bg-main),0_0_3px_var(--bg-main)]" style="${labelSide}">${s.short}${row && phase === 'optimised' ? ` <span class="num font-normal text-fg-3">${hm(row.arrival)}</span>` : ''}</div>
          </div>`,
          () => onSelectRef.current(selectedId === s.id ? null : s.id),
        ),
        [s.lng, s.lat],
        selected ? 20 : 10,
        offset,
      )
    })
  }, [styleVersion, stops, primaryPlan, selectedId, layers, phase, view, result, depot, offsets, jams, compact, labelled])

  // camera
  const fit = (duration = 700) => {
    const map = mapRef.current
    if (!map) return
    const b = new LngLatBounds()
    b.extend([depot.lng, depot.lat])
    stops.forEach((s) => b.extend([s.lng, s.lat]))
    userMoved.current = false
    const sticky = map.getPadding()
    if (sticky.top || sticky.bottom || sticky.left || sticky.right) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 })
    map.fitBounds(b, { padding: clampPadding(map, padding), duration, maxZoom: 12.5 })
  }
  const fitRef = useRef(fit)
  fitRef.current = fit

  useEffect(() => {
    if (!styleVersion) return
    const map = mapRef.current
    const s = selectedId ? stopById[selectedId] : null
    if (map && s) {
      // offset, not padding: easeTo({ padding }) is sticky in MapLibre and would be
      // added again on top of the next fitBounds padding (the map then zooms far out)
      const p = clampPadding(map, padding)
      map.easeTo({
        center: [s.lng, s.lat],
        zoom: Math.max(map.getZoom(), 12.4),
        offset: [(p.left - p.right) / 2, (p.top - p.bottom) / 2],
        duration: 650,
      })
    } else fit()
  }, [selectedId, padding, stops.length])

  const toggles: Array<{ key: keyof Layers; label: string; show: boolean; dot: string }> = [
    { key: 'rain', label: 'Rain', show: true, dot: 'bg-rain' },
    { key: 'parking', label: 'Carparks', show: true, dot: 'bg-fg-2' },
    { key: 'traffic', label: 'Traffic', show: phase === 'optimised', dot: 'bg-bad' },
    { key: 'baseline', label: 'Shortest route', show: phase === 'optimised' && view === 'coldroute', dot: 'bg-fg-4' },
  ]

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      {/* inline: maplibre's unlayered CSS sets position:relative on the container */}
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />

      <div
        className={clsx('absolute top-4 z-10 flex gap-1.5', compact ? 'no-scrollbar -my-1 overflow-x-auto py-1 pr-4' : 'flex-wrap')}
        style={{ left: (compact ? 12 : 16) + insetLeft, right: compact ? 0 : undefined }}
      >
        {toggles
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.key}
              aria-pressed={layers[t.key]}
              title={`${layers[t.key] ? 'Hide' : 'Show'} ${t.label.toLowerCase()}`}
              onClick={() => setLayers({ ...layers, [t.key]: !layers[t.key] })}
              className={clsx(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full pr-3 pl-2 text-[12px] font-medium transition-[color,box-shadow,background-color]',
                layers[t.key]
                  ? 'bg-panel text-fg shadow-[0_0_0_1.5px_var(--brand),0_1px_3px_rgba(16,24,40,0.10)]'
                  : 'bg-panel text-fg-3 shadow-[0_0_0_1px_var(--border-dark),0_1px_3px_rgba(16,24,40,0.08)] hover:text-fg hover:shadow-[0_0_0_1px_var(--text-4),0_1px_3px_rgba(16,24,40,0.08)]',
              )}
            >
              <span
                className={clsx(
                  'flex size-4 shrink-0 items-center justify-center rounded-full transition-colors',
                  layers[t.key] ? t.dot : 'shadow-[inset_0_0_0_1.5px_var(--text-4)]',
                )}
              >
                {layers[t.key] && <Check size={10} strokeWidth={3.2} className="text-panel" />}
              </span>
              {t.label}
            </button>
          ))}
      </div>

      {phase === 'optimised' && result && !compact && (
        <div
          className="absolute z-10 flex items-center gap-3.5 rounded-control bg-panel/95 px-3 py-2 text-[11px] text-fg-2 shadow-card backdrop-blur"
          style={{ left: 16 + insetLeft, bottom: 16 + insetBottom }}
        >
          <span className="flex items-center gap-1.5">
            <span className={clsx('h-[3px] w-5 rounded-full', view === 'baseline' ? 'bg-fg-2' : 'bg-brand')} />
            {view === 'baseline' ? 'Shortest route' : 'ColdRoute'}
          </span>
          {secondaryPlan && (
            <span className="flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-dashed border-fg-4" />
              {view === 'baseline' ? 'ColdRoute' : 'Shortest route'}
            </span>
          )}
          {layers.rain && (
            <span className="flex items-center gap-1.5">
              <span className="hatch-rain size-3 rounded-[3px] shadow-[inset_0_0_0_1px_var(--rain)]" />
              Rain
            </span>
          )}
          {layers.traffic && jams.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-[4px] w-5 rounded-full bg-bad" />
              Heavy traffic
            </span>
          )}
          {view !== 'baseline' && (
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border-2 border-bad" />
              Highest risk
            </span>
          )}
        </div>
      )}

      <div
        className={clsx('absolute z-10 flex flex-col overflow-hidden rounded-control bg-panel shadow-card', compact ? 'right-3' : 'right-4')}
        style={compact ? { top: 56 } : { bottom: 16 + insetBottom }}
      >
        {!compact && (
          <>
        <button aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()} className="flex size-8 items-center justify-center text-fg-2 hover:bg-hover">
          <Plus size={15} />
        </button>
        <span className="h-px bg-line" />
        <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()} className="flex size-8 items-center justify-center text-fg-2 hover:bg-hover">
          <Minus size={15} />
        </button>
        <span className="h-px bg-line" />
          </>
        )}
        <button aria-label="Fit route" onClick={() => fit()} className="flex size-8 items-center justify-center text-fg-2 hover:bg-hover">
          <LocateFixed size={14} />
        </button>
      </div>

      {props.children}
    </div>
  )
}
