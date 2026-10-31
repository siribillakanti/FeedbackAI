import { SENTIMENTS, SENTIMENT_ORDER } from '../../lib/constants'
import { formatNumber, formatPercent } from '../../lib/format'

// One 100% bar with a legend that carries counts and percentages, so the colours are
// never the only way to read it.
export function SentimentBar({ counts }) {
  const total = SENTIMENT_ORDER.reduce((sum, key) => sum + (counts[key] || 0), 0)
  if (!total) return null
  const parts = SENTIMENT_ORDER.filter((key) => counts[key])

  return (
    <div>
      <div className="flex h-3 w-full gap-px overflow-hidden rounded-sm" aria-hidden="true">
        {parts.map((key) => (
          <div key={key} style={{ width: `${(counts[key] / total) * 100}%`, background: SENTIMENTS[key].color }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {SENTIMENT_ORDER.map((key) => (
          <li key={key} className="flex items-center gap-1.5 text-ink">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: SENTIMENTS[key].color }} />
            {SENTIMENTS[key].label}
            <span className="figure text-ink-2">
              {formatNumber(counts[key] || 0)} · {formatPercent(counts[key] || 0, total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Diverging bars: complaints grow left, praise grows right, from a shared centre line.
export function AspectBars({ aspects }) {
  const max = Math.max(1, ...aspects.map((a) => Math.max(a.positive, a.negative)))
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">How often each feature is praised or criticised in reviews</caption>
      <thead>
        <tr className="text-xs text-ink-2">
          <th scope="col" className="pb-2 text-left font-medium">Feature</th>
          <th scope="col" className="pb-2 pr-2 text-right font-medium">Criticised</th>
          <th scope="col" className="pb-2 pl-2 text-left font-medium">Praised</th>
        </tr>
      </thead>
      <tbody>
        {aspects.map((aspect) => (
          <tr key={aspect.aspect} className="border-t border-rule">
            <th scope="row" className="w-[38%] py-2 pr-3 text-left font-normal text-ink">{aspect.display_name}</th>
            <td className="w-[31%] border-r border-ink-2/40 py-2 pr-2">
              <div className="flex items-center justify-end gap-2">
                <span className="figure text-xs text-ink-2">{aspect.negative || ''}</span>
                <div className="h-2.5 rounded-l-sm bg-negative" style={{ width: `${(aspect.negative / max) * 100}%` }} aria-hidden="true" />
              </div>
            </td>
            <td className="w-[31%] py-2 pl-2">
              <div className="flex items-center gap-2">
                <div className="h-2.5 rounded-r-sm bg-positive" style={{ width: `${(aspect.positive / max) * 100}%` }} aria-hidden="true" />
                <span className="figure text-xs text-ink-2">{aspect.positive || ''}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
