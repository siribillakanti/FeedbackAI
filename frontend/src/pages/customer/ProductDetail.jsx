import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useApiQuery } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { REVIEW_SORTS, FEEDBACK_STATUS } from '../../lib/constants'
import { formatPrice, formatDate, formatRating, humanizeSlug, plural } from '../../lib/format'
import { Monogram, RatingLine } from '../../components/product/ProductCard'
import { RatingBreakdown } from '../../components/product/RatingBreakdown'
import { SentimentBar, AspectBars } from '../../components/product/SentimentSummary'
import { Stars } from '../../components/ui/StarRating'
import { ReviewSentiment, DemoLabel, AspectChip } from '../../components/ui/SentimentTag'
import { InlineSelect } from '../../components/ui/Field'
import { Pagination } from '../../components/ui/Pagination'
import { ButtonLink } from '../../components/ui/Button'
import { Skeleton, ErrorState, EmptyState, LoadingRegion, Notice } from '../../components/ui/States'

const REVIEWS_PAGE_SIZE = 8

function YourReview({ product }) {
  const { user } = useAuth()
  const reviewPath = `/products/${product.slug}/review`

  if (user && user.role === 'ADMIN') return null

  let body
  if (!user) {
    body = (
      <>
        <p className="text-sm text-ink-2">Log in to rate this product and share what you think.</p>
        <ButtonLink to={`/login?next=${encodeURIComponent(reviewPath)}`} className="mt-3 w-full">Log in to review</ButtonLink>
      </>
    )
  } else if (product.my_rating) {
    const mine = product.my_rating
    const status = mine.feedback_status && mine.feedback_status !== 'PUBLISHED' ? FEEDBACK_STATUS[mine.feedback_status] : null
    body = (
      <>
        <div className="flex items-center gap-2">
          <Stars value={mine.stars} />
          <span className="text-sm text-ink-2">on {formatDate(mine.updated_at)}</span>
        </div>
        {mine.body
          ? <p className="mt-2 line-clamp-3 text-sm text-ink">{mine.title ? <strong className="font-medium">{mine.title}. </strong> : null}{mine.body}</p>
          : <p className="mt-2 text-sm text-ink-2">You rated this product without a written review.</p>}
        {status && <p className="mt-2 text-sm text-ink-2">{status.label}. {status.hint}</p>}
        {product.is_active && (
          <ButtonLink to={reviewPath} variant="secondary" className="mt-3 w-full">
            {mine.body ? 'Edit your review' : 'Add a written review'}
          </ButtonLink>
        )}
      </>
    )
  } else if (product.is_active) {
    body = (
      <>
        <p className="text-sm text-ink-2">Used it? A rating takes a few seconds; a written review helps others more.</p>
        <ButtonLink to={reviewPath} className="mt-3 w-full">Write a review</ButtonLink>
      </>
    )
  } else {
    body = <p className="text-sm text-ink-2">This product has been archived and can no longer be reviewed.</p>
  }

  return (
    <div className="panel p-5">
      <h2 className="text-sm font-semibold text-ink">{product.my_rating ? 'Your rating' : 'Rate this product'}</h2>
      <div className="mt-2">{body}</div>
    </div>
  )
}

function ReviewItem({ review }) {
  return (
    <li className="border-t border-rule py-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars value={review.stars} size="sm" />
        {review.title && <h3 className="font-medium text-ink">{review.title}</h3>}
      </div>
      <p className="mt-2 max-w-3xl whitespace-pre-line text-[15px] leading-7 text-ink">{review.body}</p>
      {review.aspects.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Features mentioned">
          {review.aspects.map((aspect) => <AspectChip key={aspect.aspect} name={aspect.display_name} polarity={aspect.polarity} />)}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2">
        <span>{review.reviewer}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={review.created_at}>{formatDate(review.created_at)}</time>
        <ReviewSentiment analysisStatus={review.analysis_status} sentiment={review.overall_sentiment} confidence={review.confidence} />
        {review.is_demo && <DemoLabel />}
      </div>
    </li>
  )
}

function Reviews({ slug, total }) {
  const [params, setParams] = useSearchParams()
  const sort = params.get('sort') || 'recent'
  const page = Number(params.get('page')) || 1
  const reviews = useApiQuery(
    ({ signal }) => api.get(`/products/${slug}/reviews`, { params: { sort, page, pageSize: REVIEWS_PAGE_SIZE }, signal }),
    [slug, sort, page]
  )

  let content
  if (reviews.error) content = <ErrorState error={reviews.error} onRetry={reviews.refetch} title="Reviews could not be loaded" />
  else if (reviews.isLoading && !reviews.data) {
    content = (
      <LoadingRegion label="Loading reviews">
        <div className="space-y-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      </LoadingRegion>
    )
  } else if (!reviews.data.length) {
    content = <EmptyState title="No written reviews yet">Ratings without text are counted above but not listed here.</EmptyState>
  } else {
    content = (
      <>
        <ul className={`border-b border-rule transition-opacity ${reviews.isLoading ? 'opacity-60' : ''}`}>
          {reviews.data.map((review) => <ReviewItem key={review.feedback_id} review={review} />)}
        </ul>
        <div className="mt-4">
          <Pagination
            meta={reviews.meta}
            label="reviews"
            onPageChange={(nextPage) => setParams({ ...(sort !== 'recent' && { sort }), page: String(nextPage) }, { preventScrollReset: true })}
          />
        </div>
      </>
    )
  }

  return (
    <section aria-labelledby="reviews-heading" className="mt-12">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="reviews-heading" className="heading">
          Reviews {reviews.meta && <span className="figure text-base font-normal text-ink-2">({reviews.meta.total})</span>}
        </h2>
        {total > 1 && (
          <InlineSelect label="Sort" value={sort} options={REVIEW_SORTS} onChange={(value) => setParams(value === 'recent' ? {} : { sort: value })} />
        )}
      </div>
      {content}
    </section>
  )
}

function Insights({ product }) {
  const analysed = Object.values(product.sentiment_summary).reduce((sum, n) => sum + n, 0)
  return (
    <section aria-labelledby="insights-heading" className="mt-12 grid gap-10 lg:grid-cols-2">
      <div>
        <h2 id="insights-heading" className="heading">What reviewers mention</h2>
        <p className="mb-4 mt-1 text-sm text-ink-2">Features picked out of the written reviews, by how often they are praised or criticised.</p>
        {product.top_aspects.length
          ? <AspectBars aspects={product.top_aspects} />
          : <EmptyState compact title="No feature highlights yet">{analysed ? 'The analysed reviews do not mention specific features.' : 'Highlights appear once the written reviews have been analysed.'}</EmptyState>}
      </div>
      <div>
        <h2 className="heading">Review sentiment</h2>
        <p className="mb-4 mt-1 text-sm text-ink-2">
          {analysed
            ? `Based on ${plural(analysed, 'analysed review')}. Mixed means a review both praises and criticises.`
            : 'The overall tone of each written review, once it has been analysed.'}
        </p>
        {analysed
          ? <SentimentBar counts={product.sentiment_summary} />
          : <EmptyState compact title="No reviews analysed yet">Sentiment is added shortly after a review is posted.</EmptyState>}
      </div>
    </section>
  )
}

export default function ProductDetail() {
  const { slug } = useParams()
  // The API records a PRODUCT_VIEW for signed-in customers when this loads.
  const query = useApiQuery(({ signal }) => api.get(`/products/${slug}`, { signal }), [slug])
  const product = query.data && query.data.slug === slug ? query.data : null

  if (query.error) {
    return (
      <div className="page py-12">
        {query.error.status === 404
          ? <EmptyState title="Product not found" action={<ButtonLink to="/explore" variant="secondary">Explore products</ButtonLink>}>It may have been removed, or the link is wrong.</EmptyState>
          : <ErrorState error={query.error} onRetry={query.refetch} title="This product could not be loaded" />}
      </div>
    )
  }

  if (!product) {
    return (
      <LoadingRegion label="Loading product">
        <div className="page space-y-4 py-8">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-10 w-96 max-w-full" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </LoadingRegion>
    )
  }

  return (
    <article className="page py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <Link to="/explore" className="hover:text-accent">Explore</Link>
        <span aria-hidden="true" className="mx-2">/</span>
        <Link to={`/categories/${product.category.slug}`} className="hover:text-accent">{product.category.name}</Link>
        <span aria-hidden="true" className="mx-2">/</span>
        <span aria-current="page" className="text-ink">{product.name}</span>
      </nav>

      {!product.is_active && (
        <div className="mt-4">
          <Notice tone="warning">This product has been archived. Its ratings and reviews are kept for reference.</Notice>
        </div>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="flex items-start gap-4">
            <Monogram brand={product.brand} size="lg" />
            <div className="min-w-0">
              <p className="text-ink-2">{product.brand}</p>
              <h1 className="title-page mt-0.5">{product.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <p className="figure text-lg text-ink">{formatPrice(product.price)}</p>
                <RatingLine average={product.avg_rating} count={product.rating_count} size="md" />
              </div>
            </div>
          </div>
          <p className="mt-6 max-w-2xl text-[16px] leading-7 text-ink">{product.description}</p>
          {product.tags.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2" aria-label="Tags">
              {product.tags.map((tag) => (
                <li key={tag}>
                  <Link to={`/explore?tag=${tag}`} className="inline-block rounded-sm border border-rule bg-surface px-2 py-1 text-xs text-ink hover:border-ink-2">
                    {humanizeSlug(tag)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <aside>
          <YourReview product={product} />
        </aside>
      </div>

      <section aria-labelledby="ratings-heading" className="mt-12 border-t border-rule pt-8">
        <h2 id="ratings-heading" className="heading mb-5">Ratings</h2>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <RatingBreakdown stats={product} />
          {product.rating_count > 0 && (
            <div className="text-sm text-ink-2">
              <p>
                <span className="font-medium text-ink">Weighted score <span className="figure">{formatRating(product.bayes_rating)}</span>.</span>{' '}
                The plain average is pulled towards the average for all products, as if this product had five extra
                ratings at that average. Products with only a few ratings cannot jump to the top of “Highest rated”, and
                the effect fades as ratings add up.
              </p>
            </div>
          )}
        </div>
      </section>

      <Insights product={product} />
      <Reviews slug={product.slug} total={product.rating_count} />
    </article>
  )
}
