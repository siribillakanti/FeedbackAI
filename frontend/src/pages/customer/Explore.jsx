import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { api } from '../../lib/api'
import { useApiQuery } from '../../lib/useApi'
import { PRODUCT_SORTS } from '../../lib/constants'
import { humanizeSlug, plural } from '../../lib/format'
import { ProductGrid } from '../../components/product/ProductCard'
import { InlineSelect } from '../../components/ui/Field'
import { Pagination } from '../../components/ui/Pagination'
import { Button } from '../../components/ui/Button'

const PAGE_SIZE = 12
const MIN_RATINGS = [
  { value: '', label: 'Any rating' },
  { value: '4', label: '4 stars and up' },
  { value: '3', label: '3 stars and up' },
  { value: '2', label: '2 stars and up' }
]

function RadioList({ legend, name, value, options, onChange }) {
  return (
    <fieldset>
      <legend className="meta mb-2 uppercase">{legend}</legend>
      <div className="space-y-1">
        {options.map((option) => (
          <label key={option.value || 'all'} className="flex cursor-pointer items-center gap-2.5 py-0.5 text-sm text-ink">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="h-4 w-4 accent-accent"
            />
            <span className="flex-1">{option.label}</span>
            {option.count !== undefined && <span className="figure text-xs text-ink-2">{option.count}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function ActiveFilter({ label, onRemove }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1.5 rounded-sm border border-rule bg-surface px-2 py-1 text-sm text-ink hover:border-ink-2"
    >
      {label}
      <X aria-hidden="true" className="h-3.5 w-3.5 text-ink-2" />
      <span className="sr-only">(remove filter)</span>
    </button>
  )
}

export default function Explore() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const category = params.get('category') || ''
  const tag = params.get('tag') || ''
  const minRating = params.get('min_rating') || ''
  const sort = params.get('sort') || 'popular'
  const page = Number(params.get('page')) || 1
  const [draft, setDraft] = useState(q)

  useEffect(() => setDraft(q), [q])

  // Any filter change goes back to page 1; empty values are dropped from the URL.
  function update(changes) {
    const nextParams = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === null || value === undefined) nextParams.delete(key)
      else nextParams.set(key, String(value))
    }
    if (!('page' in changes)) nextParams.delete('page')
    setParams(nextParams)
  }

  const categories = useApiQuery(({ signal }) => api.get('/categories', { signal }), [])
  const products = useApiQuery(
    ({ signal }) => api.get('/products', {
      params: { q: q || undefined, category: category || undefined, tag: tag || undefined, min_rating: minRating || undefined, sort, page, pageSize: PAGE_SIZE },
      signal
    }),
    [q, category, tag, minRating, sort, page]
  )

  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...(categories.data || []).map((c) => ({ value: c.slug, label: c.name, count: c.product_count }))
  ]
  const categoryName = categories.data && (categories.data.find((c) => c.slug === category) || {}).name
  const hasFilters = Boolean(q || category || tag || minRating)
  const total = products.meta ? products.meta.total : null

  const filters = (
    <div className="space-y-6">
      <RadioList legend="Category" name="category" value={category} options={categoryOptions} onChange={(value) => update({ category: value })} />
      <RadioList legend="Average rating" name="min_rating" value={minRating} options={MIN_RATINGS} onChange={(value) => update({ min_rating: value })} />
    </div>
  )

  return (
    <div className="page py-8">
      <h1 className="title-page">Explore products</h1>
      <p className="mt-1 text-ink-2" aria-live="polite">
        {total === null ? 'Loading products…' : `${plural(total, 'product')}${q ? ` matching “${q}”` : ''}${categoryName ? ` in ${categoryName}` : ''}`}
      </p>

      <div className="mt-6 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside aria-label="Filters" className="hidden lg:block">{filters}</aside>

        <div className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <form
              role="search"
              className="relative flex-1"
              onSubmit={(event) => {
                event.preventDefault()
                update({ q: draft.trim() })
              }}
            >
              <label htmlFor="explore-search" className="sr-only">Search products</label>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" />
              <input
                id="explore-search"
                type="search"
                value={draft}
                maxLength={100}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Search by name, brand or description"
                className="h-10 w-full rounded border border-rule bg-surface pl-9 pr-24 text-[15px] text-ink placeholder:text-ink-2 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <Button type="submit" size="sm" className="absolute right-1 top-1">Search</Button>
            </form>
            <InlineSelect label="Sort by" value={sort} options={PRODUCT_SORTS} onChange={(value) => update({ sort: value })} />
          </div>

          <details className="mt-3 rounded border border-rule bg-surface lg:hidden">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-ink">Filters</summary>
            <div className="border-t border-rule px-4 py-4">{filters}</div>
          </details>

          {hasFilters && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {q && <ActiveFilter label={`“${q}”`} onRemove={() => update({ q: '' })} />}
              {category && <ActiveFilter label={categoryName || humanizeSlug(category)} onRemove={() => update({ category: '' })} />}
              {tag && <ActiveFilter label={`Tag: ${humanizeSlug(tag)}`} onRemove={() => update({ tag: '' })} />}
              {minRating && <ActiveFilter label={`${minRating}+ stars`} onRemove={() => update({ min_rating: '' })} />}
              <button type="button" className="link ml-1 text-sm" onClick={() => setParams(sort === 'popular' ? {} : { sort })}>
                Clear all
              </button>
            </div>
          )}

          <ProductGrid
            className="mt-5"
            columns={3}
            products={products.data}
            isLoading={products.isLoading}
            error={products.error}
            onRetry={products.refetch}
            count={6}
            emptyTitle="No products match these filters"
            emptyBody={q ? 'Try a shorter search term or a different category.' : 'Try removing a filter.'}
            emptyAction={hasFilters ? <Button variant="secondary" size="sm" onClick={() => setParams({})}>Clear filters</Button> : null}
          />
          <div className="mt-6">
            <Pagination meta={products.meta} label="products" onPageChange={(nextPage) => update({ page: nextPage })} />
          </div>
        </div>
      </div>
    </div>
  )
}
