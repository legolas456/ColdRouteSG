/**
 * ColdRoute brand: Safety Orange on warm paper, with a matching dark mode.
 * Each theme defines the UI tokens (applied as CSS variables on <html>) and
 * the matching map palette, so the basemap, route and markers always agree
 * with the panels.
 *
 * Colour roles
 *   brand     primary actions, stop numbers, selection (AA contrast with white)
 *   route     the ColdRoute line on the map (brighter than brand, reads on tiles)
 *   ok        improvements and "on time"
 *   warn      medium risk (yellow-amber, kept clear of the brand orange)
 *   bad       late, highest risk (rose, kept clear of the brand orange)
 *   rain      rain cells and weather (blue, the complement of orange)
 *   cargo-*   small dots that tell PHARMA / FROZEN / CHILLED apart
 *
 * The five alternative palettes explored earlier (teal, glacier, indigo,
 * night teal, mono) are in git history: commit 94abb12.
 */

export type ThemeId = 'light' | 'dark'

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
  dark: boolean
  vars: Record<string, string>
  map: MapPalette
}

const LIGHT: Theme = {
  id: 'light',
  name: 'Safety Orange',
  dark: false,
  vars: {
    '--bg-main': '#f8f7f5',
    '--bg-panel': '#ffffff',
    '--bg-subtle': '#f3f1ee',
    '--fill-hover': 'rgba(55, 53, 47, 0.04)',
    '--fill-strong': 'rgba(55, 53, 47, 0.08)',
    '--fill-stronger': 'rgba(55, 53, 47, 0.14)',
    '--text-1': '#1c1917',
    '--text-2': '#57534e',
    '--text-3': '#78716c',
    '--text-4': '#a8a29e',
    '--border-main': '#ece9e4',
    '--border-dark': '#d6d3cf',
    '--ink': '#1c1917',
    '--on-ink': '#ffffff',
    '--brand': '#d3460a',
    '--brand-hover': '#bd3f09',
    '--brand-soft': '#fef1e8',
    '--brand-text': '#c2410c',
    '--on-brand': '#ffffff',
    '--ok': '#079455',
    '--ok-soft': '#ecfdf3',
    '--warn': '#ca8504',
    '--warn-soft': '#fefbe8',
    '--bad': '#e31b54',
    '--bad-soft': '#fff1f3',
    '--rain': '#2e90fa',
    '--rain-soft': '#eff8ff',
    '--cargo-pharma': '#7a5af8',
    '--cargo-frozen': '#2e90fa',
    '--cargo-chilled': '#06aed4',
    '--shadow-card': '0 0 0 1px rgba(28,25,23,0.05), 0 1px 2px rgba(28,25,23,0.04), 0 8px 24px rgba(28,25,23,0.04)',
    '--shadow-float': '0 0 0 1px rgba(28,25,23,0.06), 0 12px 32px rgba(28,25,23,0.10)',
    '--r-panel': '14px',
    '--r-control': '8px',
  },
  map: {
    base: 'light',
    bg: '#f1efeb',
    land: '#f1efeb',
    park: '#e3e9da',
    water: '#d5e2e6',
    waterLine: '#c7d6db',
    building: '#e8e5df',
    road: '#ffffff',
    casing: '#e2ded7',
    boundary: '#d6d1c9',
    label: '#9a948a',
    waterLabel: '#7d9aa3',
    halo: '#f1efeb',
    route: '#ec5d13',
    routeCasing: '#ffffff',
    baseline: '#a8a29e',
    walk: '#57534e',
    rain: '#2e90fa',
    rainHatch: 'rgba(46,144,250,0.72)',
    traffic: '#e31b54',
  },
}

const DARK: Theme = {
  id: 'dark',
  name: 'Night Shift',
  dark: true,
  vars: {
    '--bg-main': '#12110f',
    '--bg-panel': '#1a1816',
    '--bg-subtle': '#221f1c',
    '--fill-hover': 'rgba(255,255,255,0.04)',
    '--fill-strong': 'rgba(255,255,255,0.08)',
    '--fill-stronger': 'rgba(255,255,255,0.14)',
    '--text-1': '#f2efea',
    '--text-2': '#b8b2aa',
    '--text-3': '#8a847c',
    '--text-4': '#5a554f',
    '--border-main': 'rgba(255,255,255,0.07)',
    '--border-dark': 'rgba(255,255,255,0.13)',
    '--ink': '#f2efea',
    '--on-ink': '#12110f',
    '--brand': '#ff7a33',
    '--brand-hover': '#ff8f52',
    '--brand-soft': 'rgba(255,122,51,0.13)',
    '--brand-text': '#ff9a5c',
    '--on-brand': '#1f0c02',
    '--ok': '#47cd89',
    '--ok-soft': 'rgba(71,205,137,0.12)',
    '--warn': '#fac515',
    '--warn-soft': 'rgba(250,197,21,0.12)',
    '--bad': '#fd6f8e',
    '--bad-soft': 'rgba(253,111,142,0.13)',
    '--rain': '#53b1fd',
    '--rain-soft': 'rgba(83,177,253,0.12)',
    '--cargo-pharma': '#9b8afb',
    '--cargo-frozen': '#53b1fd',
    '--cargo-chilled': '#67e3f9',
    '--shadow-card': '0 0 0 1px rgba(255,255,255,0.06)',
    '--shadow-float': '0 0 0 1px rgba(255,255,255,0.08), 0 16px 40px rgba(0,0,0,0.5)',
    '--r-panel': '14px',
    '--r-control': '8px',
  },
  map: {
    base: 'dark',
    bg: '#151412',
    land: '#151412',
    park: '#161a14',
    water: '#0d1115',
    waterLine: '#10151a',
    building: '#1d1b18',
    road: '#2a2723',
    casing: '#1f1d1a',
    boundary: '#2f2b27',
    label: '#6f6961',
    waterLabel: '#4b5560',
    halo: '#151412',
    route: '#ff7a33',
    routeCasing: '#151412',
    baseline: '#6f6961',
    walk: '#b8b2aa',
    rain: '#53b1fd',
    rainHatch: 'rgba(83,177,253,0.62)',
    traffic: '#f63d68',
  },
}

export const THEMES: Theme[] = [LIGHT, DARK]
export const THEME_BY_ID: Record<ThemeId, Theme> = { light: LIGHT, dark: DARK }

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v)
  root.style.setProperty('--signal', theme.vars['--bad'])
  root.dataset.theme = theme.dark ? 'dark' : 'light'
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.vars['--bg-main'])
}
