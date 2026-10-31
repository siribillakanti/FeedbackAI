import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useApiQuery } from '../../lib/useApi'
import { ACTIVITY_TYPES } from '../../lib/constants'
import { plural } from '../../lib/format'
import { PageHeader } from '../../components/layout/Layouts'
import { ActivityList } from '../../components/product/ActivityList'
import { InlineSelect } from '../../components/ui/Field'
import { Pagination } from '../../components/ui/Pagination'
import { ButtonLink } from '../../components/ui/Button'
import { Skeleton, ErrorState, EmptyState, LoadingRegion } from '../../components/ui/States'

const PAGE_SIZE = 20
const TYPE_OPTIONS = [{ value: '', label: 'All activity' }, ...Object.entries(ACTIVITY_TYPES).map(([value, label]) => ({ value, label }))]

export default function Activity() {
  const [params, setParams] = useSearchParams()
  const type = params.get('type') || ''
  const page = Number(params.get('page')) || 1
  const query = useApiQuery(
    ({ signal }) => api.get('/me/activity', { params: { type: type || undefined, page, pageSize: PAGE_SIZE }, signal }),
    [type, page]
  )

  let content
  if (query.error) content = <ErrorState error={query.error} onRetry={query.refetch} title="Your activity could not be loaded" />
  else if (query.isLoading && !query.data) {
    content = <LoadingRegion label="Loading activity"><div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div></LoadingRegion>
  } else if (!query.data.length) {
    content = type
      ? <EmptyState title="No activity of this type">Try “All activity”.</EmptyState>
      : <EmptyState title="No activity yet" action={<ButtonLink to="/explore">Explore products</ButtonLink>}>Views, searches, ratings and reviews will appear here.</EmptyState>
  } else {
    content = (
      <>
        <div className={`transition-opacity ${query.isLoading ? 'opacity-60' : ''}`}>
          <ActivityList items={query.data} />
        </div>
        <div className="mt-4">
          <Pagination meta={query.meta} label="events" onPageChange={(nextPage) => setParams({ ...(type && { type }), page: String(nextPage) })} />
        </div>
      </>
    )
  }

  return (
    <div>
      <PageHeader
        title="Activity"
        description={query.meta ? `${plural(query.meta.total, 'event')}. Views and searches help shape your recommendations.` : 'What you have viewed, searched for and rated.'}
        actions={<InlineSelect label="Show" value={type} options={TYPE_OPTIONS} onChange={(value) => setParams(value ? { type: value } : {})} />}
      />
      {content}
    </div>
  )
}
