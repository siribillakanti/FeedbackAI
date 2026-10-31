import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

export function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`rounded bg-paper-2 motion-safe:animate-pulse ${className}`} />
}

// Announces loading once for screen readers while skeleton blocks fill the space.
export function LoadingRegion({ label = 'Loading', children }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  )
}

export function EmptyState({ title, children, action, compact = false }) {
  return (
    <div className={`rounded border border-dashed border-rule text-center ${compact ? 'px-4 py-6' : 'px-6 py-12'}`}>
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, title = 'This section could not be loaded' }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded border border-negative/40 bg-negative-soft px-4 py-4 sm:flex-row sm:items-center">
      <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-negative" />
      <div className="flex-1 text-sm">
        <p className="font-medium text-ink">{title}</p>
        <p className="text-ink-2">{error ? error.message : 'Please try again.'}</p>
      </div>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  )
}

export function Notice({ children, tone = 'info' }) {
  const toneClass = tone === 'warning' ? 'border-mixed/50 bg-[#faf1e1]' : 'border-rule bg-paper-2'
  return <div className={`rounded border px-4 py-3 text-sm text-ink ${toneClass}`}>{children}</div>
}
