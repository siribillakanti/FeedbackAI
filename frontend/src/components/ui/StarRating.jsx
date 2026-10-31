import { useId, useState } from 'react'
import { Star } from 'lucide-react'

const SIZES = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-5 w-5' }

function StarRow({ className, filled }) {
  return (
    // w-max and shrink-0 keep the clipped overlay row the same size as the full row.
    <span className="flex w-max gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <Star key={index} className={`shrink-0 ${className}`} fill={filled ? 'currentColor' : 'none'} strokeWidth={1.5} />
      ))}
    </span>
  )
}

// Read-only stars. Fractions are drawn by clipping a filled row over an outline row.
export function Stars({ value, size = 'md', className = '' }) {
  const safe = Math.max(0, Math.min(5, Number(value) || 0))
  const label = `${safe.toFixed(1).replace(/\.0$/, '')} out of 5 stars`
  return (
    <span role="img" aria-label={label} className={`relative inline-flex text-ink ${className}`}>
      <span className="text-rule"><StarRow className={SIZES[size]} filled /></span>
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${(safe / 5) * 100}%` }}>
        <StarRow className={SIZES[size]} filled />
      </span>
    </span>
  )
}

const WORDS = ['', 'Poor', 'Below average', 'Average', 'Good', 'Excellent']

// Star picker built on a native radio group, so arrow keys, Tab and screen readers
// behave as they do for any radio input.
export function StarInput({ value, onChange, error, describedBy }) {
  const name = useId()
  const [hover, setHover] = useState(0)
  const shown = hover || value || 0

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Your rating"
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="flex items-center gap-1"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((stars) => (
          <label
            key={stars}
            className="cursor-pointer rounded p-0.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
            onMouseEnter={() => setHover(stars)}
          >
            <input
              type="radio"
              name={name}
              value={stars}
              checked={value === stars}
              onChange={() => onChange(stars)}
              className="sr-only"
            />
            <span className="sr-only">{stars} {stars === 1 ? 'star' : 'stars'}, {WORDS[stars]}</span>
            <Star
              aria-hidden="true"
              strokeWidth={1.5}
              className={`h-8 w-8 transition-colors ${stars <= shown ? 'text-ink' : 'text-rule'}`}
              fill="currentColor"
            />
          </label>
        ))}
        <span className="ml-2 min-w-[7rem] text-sm text-ink-2" aria-hidden="true">{WORDS[shown]}</span>
      </div>
    </div>
  )
}
