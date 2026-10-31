import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button'
import { formatNumber } from '../../lib/format'

// meta comes from the API: { page, pageSize, total, totalPages }.
export function Pagination({ meta, onPageChange, label = 'results' }) {
  if (!meta || meta.totalPages <= 1) return null
  const { page, pageSize, total, totalPages } = meta
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
      <p className="text-sm text-ink-2">
        <span className="figure">{formatNumber(first)}–{formatNumber(last)}</span> of{' '}
        <span className="figure">{formatNumber(total)}</span> {label}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          Previous
        </Button>
        <span className="figure px-1 text-sm text-ink-2" aria-current="page">{page} / {totalPages}</span>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  )
}
