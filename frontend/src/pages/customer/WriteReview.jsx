import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useApiQuery, useApiMutation } from '../../lib/useApi'
import { useToast } from '../../context/ToastContext'
import { REVIEW_LIMITS, SENTIMENTS } from '../../lib/constants'
import { Field, Input, Textarea, CharCounter, FormError } from '../../components/ui/Field'
import { StarInput } from '../../components/ui/StarRating'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Skeleton, ErrorState, EmptyState, LoadingRegion, Notice } from '../../components/ui/States'
import { Monogram } from '../../components/product/ProductCard'

// Mirrors the API and table rules: stars 1–5, title ≤ 120, body 10–4000.
// sp_submit_review keeps the existing text when body is empty, so an existing written
// review cannot be blanked from here; deleting it is done from My feedback.
function validate(form, hadBody) {
  const errors = {}
  const body = form.body.trim()
  if (!form.stars) errors.stars = 'Choose a star rating'
  if (form.title.trim().length > REVIEW_LIMITS.title) errors.title = `Title must be at most ${REVIEW_LIMITS.title} characters`
  if (hadBody && !body) errors.body = 'Your review needs some text. To remove it, delete the review from My feedback.'
  else if (body && body.length < REVIEW_LIMITS.bodyMin) errors.body = `Write at least ${REVIEW_LIMITS.bodyMin} characters, or leave this empty to submit only a rating`
  else if (body.length > REVIEW_LIMITS.bodyMax) errors.body = `Review must be at most ${REVIEW_LIMITS.bodyMax} characters`
  return errors
}

function savedMessage(review, isEdit) {
  const action = isEdit ? 'updated' : 'saved'
  if (!review.feedback_id) return `Rating ${action}.`
  if (review.analysis_status === 'COMPLETED' && review.overall_sentiment) {
    return `Review ${action}. Sentiment: ${SENTIMENTS[review.overall_sentiment].label.toLowerCase()}.`
  }
  return `Review ${action}. Sentiment analysis is pending and will appear once it has run.`
}

function ReviewForm({ product }) {
  const navigate = useNavigate()
  const toast = useToast()
  const mine = product.my_rating
  const hadBody = Boolean(mine && mine.body)
  const [form, setForm] = useState({ stars: mine ? mine.stars : 0, title: (mine && mine.title) || '', body: (mine && mine.body) || '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const { mutate, isPending } = useApiMutation((payload) => api.put(`/me/reviews/${product.product_id}`, payload))

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  async function onSubmit(event) {
    event.preventDefault()
    const errors = validate(form, hadBody)
    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length) return

    try {
      const { data } = await mutate({
        stars: form.stars,
        title: form.title.trim() || null,
        body: form.body.trim() || null
      })
      toast.show(savedMessage(data, Boolean(mine)))
      navigate(`/products/${product.slug}`)
    } catch (err) {
      setFieldErrors(err.fields)
      setFormError(err)
    }
  }

  const titleLength = form.title.trim().length
  const bodyLength = form.body.trim().length

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 space-y-6">
      <FormError error={formError} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Your rating</legend>
        <StarInput value={form.stars} onChange={(stars) => setForm((prev) => ({ ...prev, stars }))} error={fieldErrors.stars} describedBy={fieldErrors.stars ? 'stars-error' : undefined} />
        {fieldErrors.stars && <p id="stars-error" className="mt-1.5 text-[13px] text-negative">{fieldErrors.stars}</p>}
      </fieldset>

      <Field label="Title" optional error={fieldErrors.title} counter={<CharCounter length={titleLength} max={REVIEW_LIMITS.title} />}>
        {(props) => <Input {...props} value={form.title} onChange={set('title')} error={fieldErrors.title} placeholder="Sum it up in a few words" />}
      </Field>

      <Field
        label="Review"
        optional={!hadBody}
        hint="What did you like or dislike? Mention specifics such as battery, fit or delivery; they show up in the product's highlights."
        error={fieldErrors.body}
        counter={<CharCounter length={bodyLength} max={REVIEW_LIMITS.bodyMax} min={REVIEW_LIMITS.bodyMin} />}
      >
        {(props) => <Textarea {...props} rows={8} value={form.body} onChange={set('body')} error={fieldErrors.body} />}
      </Field>

      <Notice>
        Written reviews are published straight away and analysed for sentiment. Editing the text sends it for analysis again.
      </Notice>

      <div className="flex flex-col-reverse gap-2 border-t border-rule pt-6 sm:flex-row sm:justify-end">
        <ButtonLink to={`/products/${product.slug}`} variant="secondary">Cancel</ButtonLink>
        <Button type="submit" loading={isPending}>{mine ? 'Save changes' : 'Submit review'}</Button>
      </div>
    </form>
  )
}

export default function WriteReview() {
  const { slug } = useParams()
  const query = useApiQuery(({ signal }) => api.get(`/products/${slug}`, { signal }), [slug])
  const product = query.data && query.data.slug === slug ? query.data : null

  useEffect(() => {
    if (product) document.title = `Review ${product.name} · FeedbackAI`
    return () => { document.title = 'FeedbackAI' }
  }, [product])

  let content
  if (query.error) {
    content = query.error.status === 404
      ? <EmptyState title="Product not found" action={<ButtonLink to="/explore" variant="secondary">Explore products</ButtonLink>} />
      : <ErrorState error={query.error} onRetry={query.refetch} />
  } else if (!product) {
    content = (
      <LoadingRegion label="Loading review form">
        <Skeleton className="h-10 w-80 max-w-full" />
        <Skeleton className="mt-8 h-64 w-full" />
      </LoadingRegion>
    )
  } else {
    content = (
      <>
        <Link to={`/products/${product.slug}`} className="flex items-center gap-3 text-ink-2 hover:text-accent">
          <Monogram brand={product.brand} />
          <span>
            <span className="block text-sm">{product.brand}</span>
            <span className="block font-medium text-ink">{product.name}</span>
          </span>
        </Link>
        <h1 className="title-page mt-6">{product.my_rating ? 'Edit your review' : 'Write a review'}</h1>
        {product.is_active
          ? <ReviewForm key={product.product_id} product={product} />
          : <div className="mt-6"><Notice tone="warning">This product has been archived and can no longer be reviewed.</Notice></div>}
      </>
    )
  }

  return <div className="page max-w-2xl py-8">{content}</div>
}
