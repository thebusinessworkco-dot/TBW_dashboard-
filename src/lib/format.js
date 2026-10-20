const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export { MONTHS, DAYS }

export const money = (n, symbol = '₹', dp = 2) => {
  const num = Number(n) || 0
  const sign = num < 0 ? '-' : ''
  const locale = symbol === '$' ? 'en-US' : 'en-IN'
  return (
    sign +
    symbol +
    Math.abs(num).toLocaleString(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp })
  )
}

export const whole = (n, symbol = '₹') => money(n, symbol, 0)

export const compact = (n, symbol = '₹') => {
  const a = Math.abs(Number(n) || 0)
  if (symbol === '₹') {
    if (a >= 1e7) return `${symbol}${(a / 1e7).toFixed(2).replace(/\.00$/, '')} Cr`
    if (a >= 1e5) return `${symbol}${(a / 1e5).toFixed(1).replace(/\.0$/, '')} L`
    if (a >= 1e3) return `${symbol}${(a / 1e3).toFixed(1).replace(/\.0$/, '')}k`
    return `${symbol}${a.toLocaleString('en-IN')}`
  }
  if (a >= 1e6) return `${symbol}${(a / 1e6).toFixed(1).replace(/\.0$/, '')}m`
  if (a >= 1e3) return `${symbol}${(a / 1e3).toFixed(1).replace(/\.0$/, '')}k`
  return `${symbol}${a}`
}

const two = (n) => String(n).padStart(2, '0')

export const clock = (d) => {
  const h = d.getHours() % 12 || 12
  return `${two(h)}:${two(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
}

/** 17 Apr, 2026 03:45 PM — the format the design uses in Recent Activities. */
export const stamp = (iso) => {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${d.getFullYear()} ${clock(d)}`
}

export const shortDate = (iso) => {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`
}

export const isoDay = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`

export const localIso = (d = new Date()) => `${isoDay(d)}T${two(d.getHours())}:${two(d.getMinutes())}`

export const uid = () => Math.random().toString(36).slice(2, 9)

export const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
