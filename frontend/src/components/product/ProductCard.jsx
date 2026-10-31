import { Link } from 'react-router-dom'
import { Stars } from '../ui/StarRating'
import { Skeleton, LoadingRegion, EmptyState, ErrorState } from '../ui/States'
import { formatPrice, formatRating, formatNumber } from '../../lib/format'

// Seeded products have no photos, so the card leads with a brand monogram rather than a
// stock image.
export function Monogram({ brand, size = 'md' }) {
  const box = size === 'lg' ? 'h-16 w-16 text-[28px]' : 'h-10 w-10 text-lg'
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded bg-paper-2 font-serif font-semibold text-ink-2 ${box}`}>
      {Array.from(brand.trim())[0]}
    </span>
  )
}

export function RatingLine({ average, count, size = 'sm' }) {
  if (!count) return <p className="text-sm text-ink-2">No ratings yet</p>
  return (
    <p className="flex items-center gap-1.5 text-sm text-ink-2">
      <Stars value={average} size={size} />
      <span className="figure text-ink">{formatRating(average)}</span>
      <span className="figure">({formatNumber(count)})</span>
    </p>
  )
}

export function ProductCard({ product, showCategory = true }) {
  return (
    <Link
      to={`/products/${product.slug}`}
      className="group flex h-full flex-col rounded border border-rule bg-surface p-4 transition-colors hover:border-ink-2"
    >
      <div className="flex items-center gap-3">
        <Monogram brand={product.brand} />
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-2">{product.brand}</p>
          {showCategory && <p className="meta truncate">{product.category.name}</p>}
        </div>
      </div>
      <h3 className="mt-3 line-clamp-2 font-medium leading-6 text-ink group-hover:text-accent">{product.name}</h3>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-1 pt-3">
        <RatingLine average={product.avg_rating} count={product.rating_count} />
        <p className="figure text-[15px] text-ink">{formatPrice(product.price)}</p>
      </div>
    </Link>
  )
}

const GRIDS = {
  3: 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3',
  4: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
}

export function ProductGrid({ products, isLoading, error, onRetry, count = 8, columns = 4, emptyTitle = 'No products found', emptyBody, emptyAction, showCategory, className = '' }) {
  const GRID = GRIDS[columns]
  if (error) return <ErrorState error={error} onRetry={onRetry} title="Products could not be loaded" />
  if (isLoading && !products) {
    return (
      <LoadingRegion label="Loading products">
        <div className={`${GRID} ${className}`}>
          {Array.from({ length: count }, (_, index) => <Skeleton key={index} className="h-[148px]" />)}
        </div>
      </LoadingRegion>
    )
  }
  if (!products || products.length === 0) {
    return <EmptyState title={emptyTitle} action={emptyAction}>{emptyBody}</EmptyState>
  }
  return (
    <ul className={`${GRID} ${className} transition-opacity ${isLoading ? 'opacity-60' : ''}`} aria-busy={isLoading || undefined}>
      {products.map((product) => (
        <li key={product.product_id}>
          <ProductCard product={product} showCategory={showCategory} />
        </li>
      ))}
    </ul>
  )
}
