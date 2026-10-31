import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, afterLoginPath } from '../../context/AuthContext'
import { api } from '../../lib/api'
import { useApiQuery, useApiMutation } from '../../lib/useApi'
import { Field, Input, Checkbox, FormError } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/States'

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Mirrors the API rules so most mistakes are caught before a round trip.
function validate(form) {
  const errors = {}
  if (form.full_name.trim().length < 2) errors.full_name = 'Name must be at least 2 characters'
  if (!EMAIL_SHAPE.test(form.email.trim())) errors.email = 'Enter a valid email address'
  if (form.password.length < 8) errors.password = 'Password must be at least 8 characters'
  else if (new TextEncoder().encode(form.password).length > 72) errors.password = 'Password must be at most 72 bytes'
  return errors
}

export function CategoryChoices({ categories, selected, onToggle, isLoading, error }) {
  if (isLoading) return <Skeleton className="h-24 w-full" />
  if (error) return <p className="text-sm text-ink-2">Categories could not be loaded. You can choose them later in your profile.</p>
  return (
    <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      {categories.map((category) => (
        <Checkbox
          key={category.category_id}
          label={category.name}
          checked={selected.includes(category.category_id)}
          onChange={() => onToggle(category.category_id)}
        />
      ))}
    </div>
  )
}

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')
  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [categoryIds, setCategoryIds] = useState([])
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const categories = useApiQuery(({ signal }) => api.get('/categories', { signal }), [])
  const { mutate, isPending } = useApiMutation(register)

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))
  const toggle = (id) => setCategoryIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  async function onSubmit(event) {
    event.preventDefault()
    const errors = validate(form)
    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length) return

    try {
      const user = await mutate({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        password: form.password,
        preferred_category_ids: categoryIds
      })
      navigate(afterLoginPath(next, user), { replace: true })
    } catch (err) {
      setFieldErrors(err.code === 'EMAIL_TAKEN' ? { email: err.message } : err.fields)
      if (err.code !== 'EMAIL_TAKEN') setFormError(err)
    }
  }

  return (
    <div className="panel p-6 sm:p-8">
      <h1 className="title-page">Create an account</h1>
      <p className="mt-1 text-ink-2">Rate and review products, and get recommendations based on what you like.</p>
      <form className="mt-6 space-y-5" onSubmit={onSubmit} noValidate>
        <FormError error={formError} />
        <Field label="Full name" error={fieldErrors.full_name}>
          {(props) => <Input {...props} autoComplete="name" value={form.full_name} onChange={set('full_name')} error={fieldErrors.full_name} maxLength={100} />}
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          {(props) => <Input {...props} type="email" autoComplete="email" value={form.email} onChange={set('email')} error={fieldErrors.email} maxLength={150} />}
        </Field>
        <Field label="Password" hint="At least 8 characters." error={fieldErrors.password}>
          {(props) => <Input {...props} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={fieldErrors.password} />}
        </Field>
        <fieldset>
          <legend className="text-sm font-medium text-ink">
            Categories you are interested in <span className="font-normal text-ink-2">(optional)</span>
          </legend>
          <p className="mb-3 mt-0.5 text-[13px] leading-5 text-ink-2">Used to recommend products before you have rated anything.</p>
          <CategoryChoices
            categories={categories.data || []}
            selected={categoryIds}
            onToggle={toggle}
            isLoading={categories.isLoading}
            error={categories.error}
          />
          {fieldErrors.preferred_category_ids && (
            <p className="mt-1.5 text-[13px] text-negative">{fieldErrors.preferred_category_ids}</p>
          )}
        </fieldset>
        <Button type="submit" className="w-full" loading={isPending}>Create account</Button>
      </form>
      <p className="mt-6 border-t border-rule pt-5 text-sm text-ink-2">
        Already have an account?{' '}
        <Link to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="link">Log in</Link>
      </p>
    </div>
  )
}
