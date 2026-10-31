import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { api } from '../../lib/api'
import { useApiQuery } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { ButtonLink } from '../../components/ui/Button'
import { Skeleton, ErrorState, LoadingRegion } from '../../components/ui/States'
import { ProductGrid } from '../../components/product/ProductCard'
import { formatNumber, formatRating } from '../../lib/format'

function CatalogueFigures({ categories }) {
  const products = categories.reduce((sum, c) => sum + c.product_count, 0)
  const reviews = categories.reduce((sum, c) => sum + c.review_count, 0)
  const figures = [
    { label: 'Categories', value: categories.length },
    { label: 'Products', value: products },
    { label: 'Published reviews', value: reviews }
  ]
  return (
    <dl className="grid grid-cols-3 divide-x divide-rule border-y border-rule">
      {figures.map((figure) => (
        <div key={figure.label} className="px-3 py-4 first:pl-0 sm:px-5">
          <dt className="meta">{figure.label}</dt>
          <dd className="figure mt-1 text-2xl text-ink">{formatNumber(figure.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function CategoryList({ query }) {
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} title="Categories could not be loaded" />
  if (query.isLoading && !query.data) {
    return (
      <LoadingRegion label="Loading categories">
        <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </LoadingRegion>
    )
  }
  return (
    <ul className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
      {query.data.map((category) => (
        <li key={category.category_id} className="border-t border-rule">
          <Link to={`/categories/${category.slug}`} className="group block h-full py-5">
            <p className="flex items-center justify-between gap-2 font-medium text-ink group-hover:text-accent">
              {category.name}
              <ArrowRight aria-hidden="true" className="h-4 w-4 text-ink-2 transition-colors group-hover:text-accent" />
            </p>
            <p className="mt-1 text-sm text-ink-2">{category.description}</p>
            <p className="figure mt-2 text-xs text-ink-2">
              {formatNumber(category.product_count)} products · {formatRating(category.avg_rating)} avg · {formatNumber(category.review_count)} reviews
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Section({ title, link, children }) {
  return (
    <section className="mt-14">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="heading">{title}</h2>
        {link}
      </div>
      {children}
    </section>
  )
}

const STEPS = [
  ['Rate and review', 'Give a product one to five stars and, if you like, say why. You can edit it later.'],
  ['Each review is read', 'A sentiment model labels the review positive, neutral or negative, and picks out the features it mentions, such as battery life or fit.'],
  ['Suggestions with reasons', 'Recommendations come from the products you rate and browse, and each one says why it was suggested.']
]

export default function Landing() {
  const { user } = useAuth()
  const categories = useApiQuery(({ signal }) => api.get('/categories', { signal }), [])
  const topRated = useApiQuery(({ signal }) => api.get('/products', { params: { sort: 'rating', pageSize: 4 }, signal }), [])
  const mostRated = useApiQuery(({ signal }) => api.get('/products', { params: { sort: 'popular', pageSize: 4 }, signal }), [])

  return (
    <div className="page pb-4 pt-10 sm:pt-14">
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
        <div>
          <h1 className="title-hero max-w-xl">Read what people actually think of a product.</h1>
          <p className="mt-4 max-w-xl text-[17px] leading-7 text-ink-2">
            FeedbackAI collects star ratings and written reviews for everyday products, reads each review for
            sentiment and the features it mentions, and suggests what to look at next.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink to="/explore">Explore products</ButtonLink>
            {user
              ? <ButtonLink to={user.role === 'ADMIN' ? '/admin' : '/account'} variant="secondary">Go to your account</ButtonLink>
              : <ButtonLink to="/register" variant="secondary">Create an account</ButtonLink>}
          </div>
        </div>
        <div>
          {categories.data ? <CatalogueFigures categories={categories.data} /> : <Skeleton className="h-[86px]" />}
        </div>
      </section>

      <Section title="Browse by category" link={<Link to="/explore" className="link text-sm">All products</Link>}>
        <CategoryList query={categories} />
      </Section>

      <Section title="Highest rated" link={<Link to="/explore?sort=rating" className="link text-sm">See all</Link>}>
        <ProductGrid products={topRated.data} isLoading={topRated.isLoading} error={topRated.error} onRetry={topRated.refetch} count={4} />
        <p className="mt-3 text-[13px] text-ink-2">
          Ranked by a weighted average, so a product with two five-star ratings does not outrank one with forty good ones.
        </p>
      </Section>

      <Section title="Most rated" link={<Link to="/explore?sort=popular" className="link text-sm">See all</Link>}>
        <ProductGrid products={mostRated.data} isLoading={mostRated.isLoading} error={mostRated.error} onRetry={mostRated.refetch} count={4} />
      </Section>

      <section className="mt-14 border-t border-rule pt-8">
        <h2 className="heading">How it works</h2>
        <ol className="mt-5 grid gap-6 md:grid-cols-3">
          {STEPS.map(([title, body], index) => (
            <li key={title} className="flex gap-4">
              <span className="figure text-sm text-ink-2">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <p className="font-medium text-ink">{title}</p>
                <p className="mt-1 text-sm text-ink-2">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
