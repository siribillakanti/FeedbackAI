import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useApiQuery } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { formatNumber, formatRating, plural } from '../../lib/format'
import { PageHeader } from '../../components/layout/Layouts'
import { SentimentBar } from '../../components/product/SentimentSummary'
import { ActivityList } from '../../components/product/ActivityList'
import { ButtonLink } from '../../components/ui/Button'
import { Skeleton, ErrorState, EmptyState, LoadingRegion } from '../../components/ui/States'

function Figures({ summary }) {
  const figures = [
    ['Products rated', formatNumber(summary.ratings_count)],
    ['Written reviews', formatNumber(summary.reviews_count)],
    ['Average stars given', formatRating(summary.avg_stars_given)],
    ['Products viewed', formatNumber(summary.products_viewed)]
  ]
  return (
    // A 1px gap over a rule-coloured background draws the dividers between cells.
    <dl className="grid grid-cols-2 gap-px border-y border-rule bg-rule md:grid-cols-4">
      {figures.map(([label, value]) => (
        <div key={label} className="bg-paper px-4 py-4 md:first:pl-0">
          <dt className="meta">{label}</dt>
          <dd className="figure mt-1 text-[26px] leading-8 text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const query = useApiQuery(({ signal }) => api.get('/me/summary', { signal }), [])
  const firstName = user.full_name.split(' ')[0]

  if (query.error) {
    return (
      <>
        <PageHeader title={`Hello, ${firstName}`} />
        <ErrorState error={query.error} onRetry={query.refetch} title="Your summary could not be loaded" />
      </>
    )
  }

  if (!query.data) {
    return (
      <LoadingRegion label="Loading your summary">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-6 h-20 w-full" />
        <Skeleton className="mt-8 h-48 w-full" />
      </LoadingRegion>
    )
  }

  const summary = query.data
  const { UNANALYSED: waiting, ...sentiment } = summary.sentiment
  const analysed = Object.values(sentiment).reduce((sum, n) => sum + n, 0)

  return (
    <div>
      <PageHeader
        title={`Hello, ${firstName}`}
        description="Your ratings, reviews and recent activity in one place."
        actions={<ButtonLink to="/explore" variant="secondary">Find something to rate</ButtonLink>}
      />
      <Figures summary={summary} />

      <div className="mt-10 grid gap-10 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="recent-heading">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="recent-heading" className="heading">Recent activity</h2>
            <Link to="/account/activity" className="link text-sm">All activity</Link>
          </div>
          {summary.recent_activity.length
            ? <ActivityList items={summary.recent_activity} />
            : <EmptyState compact title="Nothing here yet">Products you view, search for and rate will show up here.</EmptyState>}
        </section>

        <section aria-labelledby="tone-heading">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="tone-heading" className="heading">How your reviews read</h2>
            <Link to="/account/feedback" className="link text-sm">My feedback</Link>
          </div>
          {summary.reviews_count === 0 ? (
            <EmptyState compact title="No written reviews yet">Once you write a review, its sentiment appears here.</EmptyState>
          ) : (
            <div className="space-y-3">
              {analysed > 0 && <SentimentBar counts={sentiment} />}
              <p className="text-sm text-ink-2">
                {analysed > 0 && `${plural(analysed, 'review')} analysed. `}
                {waiting > 0 && `${plural(waiting, 'review')} waiting for sentiment analysis.`}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
