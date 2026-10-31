// Display formatting. Prices are stored in rupees.

const priceFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const numberFormat = new Intl.NumberFormat('en-IN')
const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'
})
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export const formatPrice = (value) => priceFormat.format(Number(value))
export const formatNumber = (value) => numberFormat.format(Number(value))
export const formatDate = (value) => dateFormat.format(new Date(value))
export const formatDateTime = (value) => dateTimeFormat.format(new Date(value))

// One decimal for averages; "–" when there is nothing to average.
export function formatRating(value) {
  if (value === null || value === undefined) return '–'
  return Number(value).toFixed(1)
}

export function formatPercent(part, whole) {
  if (!whole) return '0%'
  return `${Math.round((part / whole) * 100)}%`
}

export const plural = (count, one, many = `${one}s`) => `${formatNumber(count)} ${count === 1 ? one : many}`

const STEPS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60]
]

export function formatRelative(value, now = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000)
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

// "noise-cancelling" -> "Noise cancelling"
export function humanizeSlug(slug) {
  const words = slug.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
