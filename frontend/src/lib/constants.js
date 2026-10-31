// Labels for API enums. Sentiment colours follow the fixed mapping in docs/02_ARCHITECTURE.md §9.

export const SENTIMENTS = {
  POSITIVE: { label: 'Positive', color: 'rgb(var(--positive))' },
  NEUTRAL: { label: 'Neutral', color: 'rgb(var(--neutral))' },
  NEGATIVE: { label: 'Negative', color: 'rgb(var(--negative))' },
  MIXED: { label: 'Mixed', color: 'rgb(var(--mixed))' }
}

export const SENTIMENT_ORDER = ['POSITIVE', 'MIXED', 'NEUTRAL', 'NEGATIVE']

// sentiment_analysis.status values other than COMPLETED, as shown to customers.
export const ANALYSIS_STATUS = {
  PENDING: 'Analysis pending',
  PROCESSING: 'Analysis pending',
  FAILED: 'Analysis pending',
  UNSUPPORTED: 'Language not analysed'
}

export const FEEDBACK_STATUS = {
  PUBLISHED: { label: 'Published', hint: 'Visible on the product page.' },
  HIDDEN: { label: 'Hidden by a moderator', hint: 'Not shown on the product page.' },
  FLAGGED: { label: 'Flagged for review', hint: 'Still visible while a moderator checks it.' }
}

export const ACTIVITY_TYPES = {
  PRODUCT_VIEW: 'Viewed product',
  CATEGORY_VIEW: 'Browsed category',
  SEARCH: 'Searched',
  RECOMMENDATION_CLICK: 'Opened recommendation',
  RATED: 'Rated',
  REVIEWED: 'Reviewed'
}

export const PRODUCT_SORTS = [
  { value: 'popular', label: 'Most rated' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' }
]

export const REVIEW_SORTS = [
  { value: 'recent', label: 'Most recent' },
  { value: 'highest', label: 'Highest rated' },
  { value: 'lowest', label: 'Lowest rated' }
]

export const REVIEW_LIMITS = { title: 120, bodyMin: 10, bodyMax: 4000 }
