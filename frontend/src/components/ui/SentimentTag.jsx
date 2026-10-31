import { SENTIMENTS, ANALYSIS_STATUS } from '../../lib/constants'

// The colour is carried by the dot; the label stays in ink so it passes contrast for
// every sentiment, including neutral and mixed.
export function SentimentTag({ sentiment, confidence }) {
  const config = SENTIMENTS[sentiment]
  if (!config) return null
  const title = confidence !== null && confidence !== undefined
    ? `${config.label}, model confidence ${Math.round(Number(confidence) * 100)}%`
    : config.label
  return (
    <span title={title} className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-surface px-2 py-0.5 text-xs font-medium text-ink">
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: config.color }} />
      {config.label}
    </span>
  )
}

// Shows the sentiment when analysis finished, otherwise why there is none yet.
export function ReviewSentiment({ analysisStatus, sentiment, confidence }) {
  if (analysisStatus === 'COMPLETED' && sentiment) {
    return <SentimentTag sentiment={sentiment} confidence={confidence} />
  }
  const text = ANALYSIS_STATUS[analysisStatus]
  if (!text) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-rule px-2 py-0.5 text-xs text-ink-2">
      {text}
    </span>
  )
}

export function DemoLabel() {
  return (
    <span
      title="Written for this demonstration and assigned to a demo account. Not a real purchase."
      className="inline-flex items-center rounded-sm bg-paper-2 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.04em] text-ink-2"
    >
      Demo data
    </span>
  )
}

const POLARITY_DOT = {
  POSITIVE: 'rgb(var(--positive))',
  NEGATIVE: 'rgb(var(--negative))',
  NEUTRAL: 'rgb(var(--neutral))'
}

const POLARITY_WORD = { POSITIVE: 'praised', NEGATIVE: 'criticised', NEUTRAL: 'mentioned' }

export function AspectChip({ name, polarity }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-rule px-1.5 py-0.5 text-xs text-ink">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: POLARITY_DOT[polarity] }} />
      {name}
      <span className="sr-only">({POLARITY_WORD[polarity]})</span>
    </span>
  )
}
