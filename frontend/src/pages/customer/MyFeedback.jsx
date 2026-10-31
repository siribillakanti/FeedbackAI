import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useApiQuery, useApiMutation } from '../../lib/useApi'
import { useToast } from '../../context/ToastContext'
import { FEEDBACK_STATUS } from '../../lib/constants'
import { formatDate, plural } from '../../lib/format'
import { PageHeader } from '../../components/layout/Layouts'
import { Stars } from '../../components/ui/StarRating'
import { ReviewSentiment, AspectChip } from '../../components/ui/SentimentTag'
import { ButtonLink, Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Pagination } from '../../components/ui/Pagination'
import { Skeleton, ErrorState, EmptyState, LoadingRegion } from '../../components/ui/States'

const PAGE_SIZE = 10

function FeedbackItem({ item, onDelete }) {
  const status = item.feedback_status && item.feedback_status !== 'PUBLISHED' ? FEEDBACK_STATUS[item.feedback_status] : null
  const edited = item.updated_at !== item.created_at

  return (
    <li className="border-t border-rule py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link to={`/products/${item.product.slug}`} className="font-medium text-ink hover:text-accent">{item.product.name}</Link>
          <p className="text-sm text-ink-2">{item.product.brand} · {item.product.category_name}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {item.product.is_active && (
            <ButtonLink to={`/products/${item.product.slug}/review`} variant="secondary" size="sm">
              <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
              Edit<span className="sr-only"> review of {item.product.name}</span>
            </ButtonLink>
          )}
          <Button variant="ghost" size="sm" onClick={() => onDelete(item)} className="text-negative">
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
            Delete<span className="sr-only"> review of {item.product.name}</span>
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
        <Stars value={item.stars} size="sm" />
        <span>{edited ? 'Updated' : 'Posted'} {formatDate(item.updated_at)}</span>
        {item.feedback_id && <ReviewSentiment analysisStatus={item.analysis_status} sentiment={item.overall_sentiment} confidence={item.confidence} />}
        {!item.product.is_active && <span>Product archived</span>}
      </div>

      {item.feedback_id ? (
        <>
          {item.title && <p className="mt-2 font-medium text-ink">{item.title}</p>}
          <p className="mt-1 line-clamp-4 whitespace-pre-line text-[15px] leading-7 text-ink">{item.body}</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-2">Rating only, no written review.</p>
      )}

      {item.aspects.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Features detected">
          {item.aspects.map((aspect) => <AspectChip key={aspect.slug} name={aspect.name} polarity={aspect.polarity} />)}
        </div>
      )}
      {status && <p className="mt-3 text-sm text-ink-2"><span className="font-medium text-ink">{status.label}.</span> {status.hint}</p>}
    </li>
  )
}

export default function MyFeedback() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const page = Number(params.get('page')) || 1
  const [pendingDelete, setPendingDelete] = useState(null)
  const reviews = useApiQuery(({ signal }) => api.get('/me/reviews', { params: { page, pageSize: PAGE_SIZE }, signal }), [page])
  const remove = useApiMutation((productId) => api.delete(`/me/reviews/${productId}`))

  async function confirmDelete() {
    const item = pendingDelete
    try {
      await remove.mutate(item.product.product_id)
      setPendingDelete(null)
      toast.show(`Your rating for ${item.product.name} was deleted.`)
      // Deleting the last item on a page moves back one page instead of showing an empty one.
      if (reviews.data.length === 1 && page > 1) setParams({ page: String(page - 1) })
      else reviews.refetch()
    } catch (err) {
      setPendingDelete(null)
      toast.show(err.message, 'error')
    }
  }

  let content
  if (reviews.error) content = <ErrorState error={reviews.error} onRetry={reviews.refetch} title="Your feedback could not be loaded" />
  else if (reviews.isLoading && !reviews.data) {
    content = <LoadingRegion label="Loading your feedback"><div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div></LoadingRegion>
  } else if (!reviews.data.length) {
    content = (
      <EmptyState title="You have not rated anything yet" action={<ButtonLink to="/explore">Explore products</ButtonLink>}>
        Ratings and reviews you write appear here, along with how each review was read.
      </EmptyState>
    )
  } else {
    content = (
      <>
        <ul className={`border-b border-rule transition-opacity ${reviews.isLoading ? 'opacity-60' : ''}`}>
          {reviews.data.map((item) => <FeedbackItem key={item.rating_id} item={item} onDelete={setPendingDelete} />)}
        </ul>
        <div className="mt-4">
          <Pagination meta={reviews.meta} label="ratings" onPageChange={(nextPage) => setParams({ page: String(nextPage) })} />
        </div>
      </>
    )
  }

  return (
    <div>
      <PageHeader
        title="My feedback"
        description={reviews.meta && reviews.meta.total
          ? `${plural(reviews.meta.total, 'rating')}, with the sentiment found in each written review.`
          : 'Your ratings and reviews.'}
      />
      {content}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this rating?"
        confirmLabel="Delete"
        pending={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      >
        {pendingDelete && (
          <p>
            Your {pendingDelete.stars}-star rating{pendingDelete.feedback_id ? ' and written review' : ''} for{' '}
            <strong className="font-medium text-ink">{pendingDelete.product.name}</strong> will be removed permanently. This cannot be undone.
          </p>
        )}
      </ConfirmDialog>
    </div>
  )
}
