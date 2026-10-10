import clsx from 'clsx'
import { LocateFixed, Minus, Plus } from 'lucide-react'
import { GeoJSONSource, LngLatBounds, Map as MapLibre, Marker, setWorkerUrl, type ExpressionSpecification, type LayerSpecification, type StyleSpecification } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RAIN } from '../data/sample'
import { legGeometry, pathFor } from '../lib/optimizer'
import { hm } from '../lib/time'
import type { Depot, OptimiseResult, Stop } from '../lib/types'
import type { MapPalette } from '../lib/themes'
import type { View } from './ResultsPanel'

// The ESM build resolves its worker relative to import.meta.url, which breaks
// once Vite pre-bundles or hashes the library. Point it at the shipped file.
setWorkerUrl(workerUrl)

export type { MapPalette }
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

function hatchImage(color: string) {
  const size = 16
  const ratio = 2
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size * ratio
  const ctx = canvas.getContext('2d')!
  ctx.scale(ratio, ratio)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (const o of [-size, 0, size]) {
    ctx.moveTo(o, size)
    ctx.lineTo(o + size, 0)
  }
  ctx.stroke()
  const data = ctx.getImageData(0, 0, size * ratio, size * ratio)
  return { width: data.width, height: data.height, data: new Uint8Array(data.data.buffer) }
}

function rainPolygon(): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lng, lat] = RAIN.center
  const ring: [number, number][] = []
  for (let i = 0; i <= 72; i++) {
    const t = (i / 72) * Math.PI * 2
    const r = RAIN.radiusKm * (1 + 0.1 * Math.sin(3 * t + 0.6) + 0.06 * Math.cos(5 * t))
    ring.push([lng + (r / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(t), lat + (r / 110.574) * Math.sin(t)])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

function addOverlays(map: MapLibre, c: MapPalette) {
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

  map.addSource('rain', { type: 'geojson', data: rainPolygon() })
  map.addLayer({ id: 'rain-tint', type: 'fill', source: 'rain', paint: { 'fill-color': c.rain, 'fill-opacity': c.base === 'dark' ? 0.1 : 0.07 } }, before)
  map.addLayer({ id: 'rain-fill', type: 'fill', source: 'rain', paint: { 'fill-pattern': 'hatch', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 1, 14, 0.45] } }, before)
  map.addLayer(
    {
      id: 'rain-line',
      type: 'line',
      source: 'rain',
      paint: { 'line-color': c.rain, 'line-opacity': 0.6, 'line-width': 1.2, 'line-dasharray': [3, 3] },
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
  map.addLayer(
    {
      id: 'traffic',
      type: 'line',
      source: 'traffic',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': c.traffic, 'line-width': 7, 'line-opacity': 0.32 },
    },
    before,
  )
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
  children?: ReactNode
}

export function MapView(props: Props) {
  const { palette, depot, stops, result, view, phase, selectedId, onSelect, layers, setLayers } = props
  const insetLeft = props.insetLeft ?? 0
  const insetBottom = props.insetBottom ?? 0
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibre | null>(null)
  const themeRef = useRef(palette)
  const markersRef = useRef<Marker[]>([])
  const animRef = useRef(0)
  const revealTimer = useRef(0)
  const [styleVersion, setStyleVersion] = useState(0)
  const stopById = useMemo(() => Object.fromEntries(stops.map((s) => [s.id, s])), [stops])

  const padding = useMemo(
    () => ({ top: 80, bottom: 64 + insetBottom, left: 72 + insetLeft, right: props.cardOpen ? 430 : 128 }),
    [insetLeft, insetBottom, props.cardOpen],
  )

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
      center: [103.835, 1.34],
      zoom: 10.7,
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
      addOverlays(map, themeRef.current)
      if (firstStyle) {
        firstStyle = false
        fitRef.current(0)
      }
      setStyleVersion((v) => v + 1)
    })
    map.on('click', () => onSelectRef.current(null))
    mapRef.current = map
    applyBasemap(map, themeRef.current)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

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

  // lines + overlay visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion || !map.getSource('route-primary')) return
    const vis = (id: string, on: boolean) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    vis('rain-tint', layers.rain)
    vis('rain-fill', layers.rain)
    vis('rain-line', layers.rain)
    vis('walk', layers.parking)
    vis('traffic', layers.traffic && !!primaryPlan)

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

    // slow segments: the final third of each approach into a congested stop
    const slow: GeoJSON.Feature<GeoJSON.LineString>[] = []
    if (primaryPlan) {
      let prev: { id: string; lng: number; lat: number } = depot
      for (const id of primaryPlan.order) {
        const s = stopById[id]
        if (s.trafficRisk >= 0.5) {
          const leg = legGeometry(prev, s)
          const a = Math.floor(leg.length * 0.45)
          const b = Math.floor(leg.length * 0.85)
          if (b - a > 1) slow.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: leg.slice(a, b) } })
        }
        prev = s
      }
    }
    ;(map.getSource('traffic') as GeoJSONSource).setData({ type: 'FeatureCollection', features: slow })

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
    }, total + 200)
  }, [styleVersion, primaryPlan, secondaryPlan, layers, depot, stopById, stops, view])

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
      anchor: 'center' | 'top-left' = 'center',
    ) => {
      el.style.zIndex = String(z)
      markersRef.current.push(new Marker({ element: el, anchor, offset }).setLngLat(lngLat).addTo(map))
    }

    // rain label
    if (layers.rain) {
      add(
        markerEl(
          `<div class="flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-[11px] font-medium text-fg shadow-card whitespace-nowrap">
            <svg class="text-rain" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/><path d="M8 19v2M8 13v2M16 19v2M16 13v2M12 21v2M12 15v2"/></svg>
            ${RAIN.label} · <span class="num">${hm(RAIN.start)}–${hm(RAIN.end)}</span></div>`,
        ),
        // south-east rim of the shower cell, label hanging off it
        [
          RAIN.center[0] + (RAIN.radiusKm * 0.72) / (111.32 * Math.cos((RAIN.center[1] * Math.PI) / 180)),
          RAIN.center[1] - (RAIN.radiusKm * 0.72) / 110.574,
        ],
        2,
        [4, 4],
        'top-left',
      )
    }

    // carparks
    if (layers.parking) {
      for (const s of stops) {
        const risky = s.parking.risk >= 0.7
        add(
          markerEl(
            `<div class="relative flex size-[18px] items-center justify-center rounded-[5px] bg-panel num text-[9.5px] font-bold text-fg-2 shadow-[inset_0_0_0_1.5px_var(--text-3)]">P
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
  }, [styleVersion, stops, primaryPlan, selectedId, layers, phase, view, result, depot, offsets])

  // camera
  const fit = (duration = 700) => {
    const map = mapRef.current
    if (!map) return
    const b = new LngLatBounds()
    b.extend([depot.lng, depot.lat])
    stops.forEach((s) => b.extend([s.lng, s.lat]))
    map.fitBounds(b, { padding, duration, maxZoom: 12.5 })
  }
  const fitRef = useRef(fit)
  fitRef.current = fit

  useEffect(() => {
    if (!styleVersion) return
    const map = mapRef.current
    const s = selectedId ? stopById[selectedId] : null
    if (map && s) {
      map.easeTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 12.4), padding, duration: 650 })
    } else fit()
  }, [selectedId, padding, stops.length])

  const toggles: Array<{ key: keyof Layers; label: string; show: boolean; dot: string }> = [
    { key: 'rain', label: 'Showers', show: true, dot: 'bg-rain' },
    { key: 'parking', label: 'Carparks', show: true, dot: 'bg-fg-2' },
    { key: 'traffic', label: 'Traffic', show: phase === 'optimised', dot: 'bg-bad' },
    { key: 'baseline', label: 'Shortest route', show: phase === 'optimised' && view === 'coldroute', dot: 'bg-fg-4' },
  ]

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      {/* inline: maplibre's unlayered CSS sets position:relative on the container */}
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />

      <div className="absolute top-4 z-10 flex flex-wrap gap-1.5" style={{ left: 16 + insetLeft }}>
        {toggles
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.key}
              onClick={() => setLayers({ ...layers, [t.key]: !layers[t.key] })}
              className={clsx(
                'flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium shadow-card transition-colors',
                layers[t.key] ? 'bg-panel text-fg shadow-[0_0_0_1.5px_var(--brand),0_1px_2px_rgba(16,24,40,0.08)]' : 'bg-panel/90 text-fg-3 hover:text-fg',
              )}
            >
              <span className={clsx('size-2 rounded-full transition-opacity', t.dot, !layers[t.key] && 'opacity-35')} />
              {t.label}
            </button>
          ))}
      </div>

      {phase === 'optimised' && result && (
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
          <span className="flex items-center gap-1.5">
            <span className="hatch-rain size-3 rounded-[3px]" />
            Showers
          </span>
          {view !== 'baseline' && (
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border-2 border-bad" />
              Highest risk
            </span>
          )}
        </div>
      )}

      <div className="absolute right-4 z-10 flex flex-col overflow-hidden rounded-control bg-panel shadow-card" style={{ bottom: 16 + insetBottom }}>
        <button aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()} className="flex size-8 items-center justify-center text-fg-2 hover:bg-hover">
          <Plus size={15} />
        </button>
        <span className="h-px bg-line" />
        <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()} className="flex size-8 items-center justify-center text-fg-2 hover:bg-hover">
          <Minus size={15} />
        </button>
        <span className="h-px bg-line" />
        <button aria-label="Fit route" onClick={() => fit()} className="flex size-8 items-center justify-center text-fg-2 hover:bg-hover">
          <LocateFixed size={14} />
        </button>
      </div>

      {props.children}
    </div>
  )
}
