import { Link } from 'react-router-dom'
import { Eye, LayoutGrid, Search, Star, MessageSquareText, MousePointerClick } from 'lucide-react'
import { ACTIVITY_TYPES } from '../../lib/constants'
import { formatRelative, formatDateTime } from '../../lib/format'
import { DemoLabel } from '../ui/SentimentTag'

const ICONS = {
  PRODUCT_VIEW: Eye,
  CATEGORY_VIEW: LayoutGrid,
  SEARCH: Search,
  RECOMMENDATION_CLICK: MousePointerClick,
  RATED: Star,
  REVIEWED: MessageSquareText
}

function Subject({ item }) {
  if (item.activity_type === 'SEARCH') {
    return (
      <Link to={`/explore?q=${encodeURIComponent(item.detail)}`} className="font-medium text-ink hover:text-accent">
        “{item.detail}”
      </Link>
    )
  }
  if (item.activity_type === 'CATEGORY_VIEW') {
    return <Link to={`/categories/${item.category_slug}`} className="font-medium text-ink hover:text-accent">{item.category_name}</Link>
  }
  return <Link to={`/products/${item.product_slug}`} className="font-medium text-ink hover:text-accent">{item.product_name}</Link>
}

// Rows from v_user_activity (interactions, ratings and reviews in one timeline).
export function ActivityList({ items, showDemo = true }) {
  return (
    <ol className="divide-y divide-rule border-y border-rule">
      {items.map((item) => {
        const Icon = ICONS[item.activity_type] || Eye
        const extra = item.activity_type === 'RATED'
          ? item.detail
          : item.activity_type === 'REVIEWED' ? `“${item.detail}”` : null
        return (
          <li key={`${item.source_table}-${item.source_id}`} className="flex gap-3 py-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-paper-2 text-ink-2" aria-hidden="true">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-ink">
                <span className="text-ink-2">{ACTIVITY_TYPES[item.activity_type]}</span> <Subject item={item} />
                {extra && <span className="text-ink-2"> · {extra}</span>}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                <time dateTime={item.occurred_at} title={formatDateTime(item.occurred_at)}>{formatRelative(item.occurred_at)}</time>
                {item.activity_type !== 'CATEGORY_VIEW' && item.category_name && <span>· {item.category_name}</span>}
                {showDemo && item.is_demo && <DemoLabel />}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
