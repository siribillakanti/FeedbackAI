import { Stars } from '../ui/StarRating'
import { formatRating, formatNumber, formatPercent, plural } from '../../lib/format'

// Average, count and star histogram from v_product_rating_stats.
export function RatingBreakdown({ stats }) {
  const total = stats.rating_count || 0
  const rows = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: stats[`stars_${stars}`] || 0 }))

  return (
    <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
      <div>
        <p className="figure text-[44px] leading-none tracking-[-0.06em] text-ink">{formatRating(stats.avg_rating)}</p>
        <Stars value={stats.avg_rating} size="md" className="mt-2" />
        <p className="mt-1 text-sm text-ink-2">{total ? plural(total, 'rating') : 'No ratings yet'}</p>
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">Number of ratings for each star level</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.stars}>
              <th scope="row" className="w-14 whitespace-nowrap py-1 pr-3 text-left font-normal text-ink-2">
                {row.stars} star
              </th>
              <td className="py-1">
                <div className="h-2 w-full rounded-sm bg-paper-2" aria-hidden="true">
                  <div className="h-2 rounded-sm bg-ink" style={{ width: total ? `${(row.count / total) * 100}%` : 0 }} />
                </div>
              </td>
              <td className="figure w-16 whitespace-nowrap py-1 pl-3 text-right text-ink-2">
                {formatNumber(row.count)} <span className="sr-only">ratings,</span>
                <span className="hidden sm:inline">· {formatPercent(row.count, total)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
