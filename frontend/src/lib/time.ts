export const hm = (minutes: number) => {
  const m = Math.round(minutes)
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const parseHm = (value: string) => {
  const [h, m] = value.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export const windowLabel = (start: number, end: number) => `${hm(start)}–${hm(end)}`

export const duration = (minutes: number) => {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

export const signed = (n: number, digits = 0) => {
  const v = Number(n.toFixed(digits))
  if (v === 0) return '±0'
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`
}
