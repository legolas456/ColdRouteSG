/**
 * Brand themes. Each theme defines the UI tokens (applied as CSS variables on
 * <html>) and the matching map palette, so the basemap, route and markers
 * always agree with the panels.
 *
 * Colour roles
 *   brand     primary actions, route line, stop numbers, selection
 *   ok        improvements and "on time"
 *   warn      medium risk
 *   bad       late, highest risk
 *   rain      shower cells and weather
 *   cargo-*   small dots that tell PHARMA / FROZEN / CHILLED apart
 */

export type ThemeId = 'teal' | 'glacier' | 'indigo' | 'orange' | 'night' | 'mono'

export interface MapPalette {
  base: 'light' | 'dark'
  bg: string
  land: string
  park: string
  water: string
  waterLine: string
  building: string
  road: string
  casing: string
  boundary: string
  label: string
  waterLabel: string
  halo: string
  route: string
  routeCasing: string
  baseline: string
  walk: string
  rain: string
  rainHatch: string
  traffic: string
}

export interface Theme {
  id: ThemeId
  name: string
  zh: string
  note: string
  dark: boolean
  /** canvas, brand, accent for the menu swatch */
  swatch: [string, string, string]
  vars: Record<string, string>
  map: MapPalette
}

const coolNeutrals = {
  '--text-1': '#101828',
  '--text-2': '#475467',
  '--text-3': '#667085',
  '--text-4': '#98a2b3',
  '--border-main': '#e8ebef',
  '--border-dark': '#d0d5dd',
  '--fill-hover': 'rgba(16, 24, 40, 0.04)',
  '--fill-strong': 'rgba(16, 24, 40, 0.07)',
  '--fill-stronger': 'rgba(16, 24, 40, 0.13)',
  '--ink': '#101828',
  '--on-ink': '#ffffff',
}

const lightSemantic = {
  '--ok': '#079455',
  '--ok-soft': '#ecfdf3',
  '--warn': '#dc6803',
  '--warn-soft': '#fffaeb',
  '--bad': '#d92d20',
  '--bad-soft': '#fef3f2',
  '--rain': '#2e90fa',
  '--rain-soft': '#eff8ff',
  '--cargo-pharma': '#7a5af8',
  '--cargo-frozen': '#2e90fa',
  '--cargo-chilled': '#06aed4',
  '--shadow-card': '0 0 0 1px rgba(16,24,40,0.05), 0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.04)',
  '--shadow-float': '0 0 0 1px rgba(16,24,40,0.06), 0 12px 32px rgba(16,24,40,0.10)',
  '--r-panel': '14px',
  '--r-control': '8px',
}

function light(bg: string, subtle: string, brand: Record<string, string>, extra: Record<string, string> = {}) {
  return { ...coolNeutrals, ...lightSemantic, '--bg-main': bg, '--bg-subtle': subtle, '--bg-panel': '#ffffff', ...brand, ...extra }
}

const brandVars = (brand: string, hover: string, soft: string, text: string, onBrand = '#ffffff') => ({
  '--brand': brand,
  '--brand-hover': hover,
  '--brand-soft': soft,
  '--brand-text': text,
  '--on-brand': onBrand,
})

const lightMap = (o: Partial<MapPalette> & Pick<MapPalette, 'route'>): MapPalette => ({
  base: 'light',
  bg: '#eef2f4',
  land: '#eef2f4',
  park: '#e1ece4',
  water: '#d3e3ec',
  waterLine: '#c4d7e3',
  building: '#e4e8eb',
  road: '#ffffff',
  casing: '#dde3e7',
  boundary: '#ccd5db',
  label: '#8a96a0',
  waterLabel: '#7096ac',
  halo: '#eef2f4',
  routeCasing: '#ffffff',
  baseline: '#98a2b3',
  walk: '#475467',
  rain: '#2e90fa',
  rainHatch: 'rgba(46,144,250,0.55)',
  traffic: '#f04438',
  ...o,
})

export const THEMES: Theme[] = [
  {
    id: 'teal',
    name: 'Arctic Teal',
    zh: '极地青',
    note: 'Cold chain and pharma. Calm, clinical, distinctive.',
    dark: false,
    swatch: ['#f4f7f7', '#0e9384', '#2e90fa'],
    vars: light('#f4f7f7', '#eef3f3', brandVars('#0e9384', '#107569', '#e6f5f2', '#107569')),
    map: lightMap({ route: '#0e9384', bg: '#edf2f2', land: '#edf2f2', halo: '#edf2f2', water: '#d0e5e9', waterLine: '#c0dadf', waterLabel: '#6a9aa4' }),
  },
  {
    id: 'glacier',
    name: 'Glacier Blue',
    zh: '冰川蓝',
    note: 'Trustworthy enterprise blue. Safe, familiar SaaS.',
    dark: false,
    swatch: ['#f5f7fa', '#155eef', '#0ba5ec'],
    vars: light('#f5f7fa', '#eff2f6', brandVars('#155eef', '#004eeb', '#eef4ff', '#004eeb'), {
      '--rain': '#0ba5ec',
      '--rain-soft': '#f0f9ff',
      '--cargo-frozen': '#0ba5ec',
    }),
    map: lightMap({
      route: '#155eef',
      bg: '#eef1f6',
      land: '#eef1f6',
      halo: '#eef1f6',
      water: '#d1def2',
      waterLine: '#c1d1eb',
      waterLabel: '#6b88b6',
      rain: '#0ba5ec',
      rainHatch: 'rgba(11,165,236,0.55)',
    }),
  },
  {
    id: 'indigo',
    name: 'Indigo',
    zh: '靛紫',
    note: 'Modern product feel, like Linear or Stripe.',
    dark: false,
    swatch: ['#f6f6fa', '#444ce7', '#0ba5ec'],
    vars: light('#f6f6fa', '#f0f0f6', brandVars('#444ce7', '#3538cd', '#eef0fe', '#3538cd'), {
      '--rain': '#0ba5ec',
      '--rain-soft': '#f0f9ff',
      '--cargo-pharma': '#dd2590',
    }),
    map: lightMap({
      route: '#444ce7',
      bg: '#f0f0f5',
      land: '#f0f0f5',
      halo: '#f0f0f5',
      water: '#dbdff2',
      waterLine: '#cdd2ec',
      waterLabel: '#7c84b8',
      park: '#e4ebe3',
      rain: '#0ba5ec',
      rainHatch: 'rgba(11,165,236,0.55)',
    }),
  },
  {
    id: 'orange',
    name: 'Safety Orange',
    zh: '信号橙',
    note: 'Logistics high-vis orange on warm paper. Energetic.',
    dark: false,
    swatch: ['#f8f7f5', '#ec5d13', '#2e90fa'],
    vars: light('#f8f7f5', '#f3f1ee', brandVars('#ec5d13', '#d14a0b', '#fef3eb', '#c4400a'), {
      '--text-1': '#1c1917',
      '--text-2': '#57534e',
      '--text-3': '#78716c',
      '--text-4': '#a8a29e',
      '--border-main': '#ece9e4',
      '--border-dark': '#d6d3cf',
      '--fill-hover': 'rgba(55, 53, 47, 0.04)',
      '--fill-strong': 'rgba(55, 53, 47, 0.08)',
      '--fill-stronger': 'rgba(55, 53, 47, 0.14)',
      '--ink': '#1c1917',
      '--warn': '#ca8504',
      '--warn-soft': '#fefbe8',
    }),
    map: lightMap({
      route: '#ec5d13',
      bg: '#f1efeb',
      land: '#f1efeb',
      halo: '#f1efeb',
      park: '#e3e9da',
      water: '#d5e2e6',
      waterLine: '#c7d6db',
      building: '#e8e5df',
      casing: '#e2ded7',
      boundary: '#d6d1c9',
      label: '#9a948a',
      waterLabel: '#7d9aa3',
      walk: '#57534e',
    }),
  },
  {
    id: 'night',
    name: 'Night Shift',
    zh: '夜间值班',
    note: 'Dark navy control room with Arctic Teal accents.',
    dark: true,
    swatch: ['#0b1220', '#2ed3b7', '#53b1fd'],
    vars: {
      '--bg-main': '#0b1220',
      '--bg-panel': '#0f182a',
      '--bg-subtle': '#152036',
      '--fill-hover': 'rgba(255,255,255,0.04)',
      '--fill-strong': 'rgba(255,255,255,0.08)',
      '--fill-stronger': 'rgba(255,255,255,0.14)',
      '--text-1': '#e6ebf5',
      '--text-2': '#a9b4c8',
      '--text-3': '#7d8aa3',
      '--text-4': '#4f5b73',
      '--border-main': 'rgba(255,255,255,0.07)',
      '--border-dark': 'rgba(255,255,255,0.14)',
      '--ink': '#e6ebf5',
      '--on-ink': '#0b1220',
      ...brandVars('#2ed3b7', '#5fe9d0', 'rgba(46,211,183,0.13)', '#5fe9d0', '#042f2a'),
      '--ok': '#47cd89',
      '--ok-soft': 'rgba(71,205,137,0.12)',
      '--warn': '#fdb022',
      '--warn-soft': 'rgba(253,176,34,0.12)',
      '--bad': '#f97066',
      '--bad-soft': 'rgba(249,112,102,0.13)',
      '--rain': '#53b1fd',
      '--rain-soft': 'rgba(83,177,253,0.12)',
      '--cargo-pharma': '#9b8afb',
      '--cargo-frozen': '#53b1fd',
      '--cargo-chilled': '#67e3f9',
      '--shadow-card': '0 0 0 1px rgba(255,255,255,0.06)',
      '--shadow-float': '0 0 0 1px rgba(255,255,255,0.08), 0 16px 40px rgba(0,0,0,0.45)',
      '--r-panel': '14px',
      '--r-control': '8px',
    },
    map: {
      base: 'dark',
      bg: '#0d1525',
      land: '#0d1525',
      park: '#0e1d23',
      water: '#070e1a',
      waterLine: '#0a1322',
      building: '#121c30',
      road: '#1b263c',
      casing: '#141e33',
      boundary: '#26324a',
      label: '#5b6a86',
      waterLabel: '#3b4b66',
      halo: '#0d1525',
      route: '#2ed3b7',
      routeCasing: '#0d1525',
      baseline: '#5b6a86',
      walk: '#a9b4c8',
      rain: '#53b1fd',
      rainHatch: 'rgba(83,177,253,0.5)',
      traffic: '#f97066',
    },
  },
  {
    id: 'mono',
    name: 'Mono',
    zh: '原版黑白',
    note: 'The previous black-and-white direction, for reference.',
    dark: false,
    swatch: ['#f8f8f7', '#1a1a19', '#a6a6a6'],
    vars: {
      '--bg-main': '#f8f8f7',
      '--bg-panel': '#ffffff',
      '--bg-subtle': '#f3f3f3',
      '--fill-hover': '#37352f0a',
      '--fill-strong': '#37352f14',
      '--fill-stronger': '#37352f24',
      '--text-1': '#1a1a1a',
      '--text-2': '#4d4d4d',
      '--text-3': '#737373',
      '--text-4': '#a6a6a6',
      '--border-main': '#0000000f',
      '--border-dark': '#00000024',
      '--ink': '#1a1a19',
      '--on-ink': '#ffffff',
      ...brandVars('#1a1a19', '#333331', '#37352f14', '#1a1a19'),
      '--ok': '#4d4d4d',
      '--ok-soft': '#37352f0a',
      '--warn': '#4d4d4d',
      '--warn-soft': '#37352f0a',
      '--bad': '#1a1a19',
      '--bad-soft': '#37352f14',
      '--rain': '#737373',
      '--rain-soft': '#37352f0a',
      '--cargo-pharma': '#a6a6a6',
      '--cargo-frozen': '#a6a6a6',
      '--cargo-chilled': '#a6a6a6',
      '--shadow-card': '0 0 0 1px #16191d0d, 0 1px 2px #16191d08, 0 8px 24px #16191d0a',
      '--shadow-float': '0 0 0 1px #16191d14, 0 12px 32px #16191d14',
      '--r-panel': '14px',
      '--r-control': '8px',
    },
    map: {
      base: 'light',
      bg: '#f2f2f0',
      land: '#ededea',
      park: '#ededea',
      water: '#e1e1de',
      waterLine: '#d9d9d6',
      building: '#e7e7e4',
      road: '#ffffff',
      casing: '#e2e2df',
      boundary: '#d4d4d1',
      label: '#9b9b97',
      waterLabel: '#b0b0ac',
      halo: '#f2f2f0',
      route: '#1a1a19',
      routeCasing: '#ffffff',
      baseline: '#a3a3a0',
      walk: '#1a1a19',
      rain: '#1a1a19',
      rainHatch: 'rgba(26,26,25,0.42)',
      traffic: '#1a1a19',
    },
  },
]

export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t])) as Record<ThemeId, Theme>

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v)
  root.style.setProperty('--signal', theme.vars['--bad'])
  root.dataset.theme = theme.dark ? 'dark' : 'light'
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.vars['--bg-main'])
}
