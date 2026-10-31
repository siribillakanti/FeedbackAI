import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useApiQuery } from '../../lib/useApi'
import { PRODUCT_SORTS } from '../../lib/constants'
import { formatNumber, formatRating } from '../../lib/format'
import { ProductGrid } from '../../components/product/ProductCard'
import { InlineSelect } from '../../components/ui/Field'
import { Pagination } from '../../components/ui/Pagination'
import { Skeleton, ErrorState, EmptyState, LoadingRegion } from '../../components/ui/States'
import { ButtonLink } from '../../components/ui/Button'

const PAGE_SIZE = 12

export default function Category() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const sort = params.get('sort') || 'popular'
  const page = Number(params.get('page')) || 1

  // The API records a CATEGORY_VIEW for signed-in customers when this loads.
  const category = useApiQuery(({ signal }) => api.get(`/categories/${slug}`, { signal }), [slug])
  const products = useApiQuery(
    ({ signal }) => api.get('/products', { params: { category: slug, sort, page, pageSize: PAGE_SIZE }, signal }),
    [slug, sort, page]
  )

  if (category.error && category.error.status === 404) {
    return (
      <div className="page py-12">
        <EmptyState title="Category not found" action={<ButtonLink to="/explore" variant="secondary">Explore all products</ButtonLink>}>
          There is no category at this address.
        </EmptyState>
      </div>
    )
  }

  const data = category.data && category.data.slug === slug ? category.data : null

  return (
    <div className="page py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <Link to="/explore" className="hover:text-accent">Explore</Link>
        <span aria-hidden="true" className="mx-2">/</span>
        <span aria-current="page">{data ? data.name : '…'}</span>
      </nav>

      {category.error ? (
        <div className="mt-4"><ErrorState error={category.error} onRetry={category.refetch} /></div>
      ) : !data ? (
        <LoadingRegion label="Loading category">
          <Skeleton className="mt-4 h-9 w-72" />
          <Skeleton className="mt-3 h-5 w-96 max-w-full" />
        </LoadingRegion>
      ) : (
        <div className="mt-3 flex flex-col gap-6 border-b border-rule pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="title-page">{data.name}</h1>
            <p className="mt-1 max-w-2xl text-ink-2">{data.description}</p>
          </div>
          <dl className="flex gap-8">
            {[
              ['Products', formatNumber(data.product_count)],
              ['Average rating', formatRating(data.avg_rating)],
              ['Reviews', formatNumber(data.review_count)]
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="meta">{label}</dt>
                <dd className="figure mt-0.5 text-xl text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <InlineSelect
          label="Sort by"
          value={sort}
          options={PRODUCT_SORTS}
          onChange={(value) => setParams(value === 'popular' ? {} : { sort: value })}
        />
      </div>
      <ProductGrid
        className="mt-4"
        products={products.data}
        isLoading={products.isLoading}
        error={products.error}
        onRetry={products.refetch}
        showCategory={false}
        emptyTitle="No products in this category yet"
      />
      <div className="mt-6">
        <Pagination
          meta={products.meta}
          label="products"
          onPageChange={(nextPage) => setParams({ ...(sort !== 'popular' && { sort }), page: String(nextPage) })}
        />
      </div>
    </div>
  )
}
