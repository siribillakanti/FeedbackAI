import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useApiQuery, useApiMutation } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { formatDate } from '../../lib/format'
import { PageHeader } from '../../components/layout/Layouts'
import { Field, Input, FormError } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { Skeleton, ErrorState, LoadingRegion } from '../../components/ui/States'
import { CategoryChoices } from './Register'

function Section({ title, description, children }) {
  return (
    <section className="grid gap-4 border-t border-rule py-8 md:grid-cols-[240px_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 className="heading">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      <div className="max-w-lg">{children}</div>
    </section>
  )
}

function DetailsForm({ profile, categories, onSaved }) {
  const toast = useToast()
  const [fullName, setFullName] = useState(profile.full_name)
  const [categoryIds, setCategoryIds] = useState(profile.preferred_categories.map((c) => c.category_id))
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const save = useApiMutation((body) => api.patch('/me/profile', body))

  const toggle = (id) => setCategoryIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  async function onSubmit(event) {
    event.preventDefault()
    const name = fullName.trim()
    setFormError(null)
    if (name.length < 2) {
      setFieldErrors({ full_name: 'Name must be at least 2 characters' })
      return
    }
    setFieldErrors({})
    try {
      const { data } = await save.mutate({ full_name: name, preferred_category_ids: categoryIds })
      onSaved(data)
      toast.show('Profile saved.')
    } catch (err) {
      setFieldErrors(err.fields)
      setFormError(err)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <FormError error={formError} />
      <Field label="Full name" error={fieldErrors.full_name}>
        {(props) => <Input {...props} autoComplete="name" value={fullName} maxLength={100} onChange={(e) => setFullName(e.target.value)} error={fieldErrors.full_name} />}
      </Field>
      <div>
        <p className="text-sm font-medium text-ink">Email</p>
        <p className="mt-1 text-[15px] text-ink">{profile.email}</p>
        <p className="mt-0.5 text-[13px] text-ink-2">Your email is your login and cannot be changed here.</p>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-ink">Preferred categories</legend>
        <p className="mb-3 mt-0.5 text-[13px] leading-5 text-ink-2">Recommendations lean towards these, especially before you have rated much.</p>
        <CategoryChoices categories={categories.data || []} selected={categoryIds} onToggle={toggle} isLoading={categories.isLoading} error={categories.error} />
        {fieldErrors.preferred_category_ids && <p className="mt-1.5 text-[13px] text-negative">{fieldErrors.preferred_category_ids}</p>}
      </fieldset>
      <Button type="submit" loading={save.isPending}>Save profile</Button>
    </form>
  )
}

function PasswordForm() {
  const toast = useToast()
  const empty = { current_password: '', new_password: '', confirm: '' }
  const [form, setForm] = useState(empty)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const change = useApiMutation((body) => api.patch('/me/password', body))

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  async function onSubmit(event) {
    event.preventDefault()
    const errors = {}
    if (!form.current_password) errors.current_password = 'Enter your current password'
    if (form.new_password.length < 8) errors.new_password = 'Password must be at least 8 characters'
    else if (form.new_password !== form.confirm) errors.confirm = 'The two new passwords do not match'
    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length) return
    try {
      await change.mutate({ current_password: form.current_password, new_password: form.new_password })
      setForm(empty)
      toast.show('Password changed.')
    } catch (err) {
      setFieldErrors(err.fields)
      if (!err.fields.current_password) setFormError(err)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <FormError error={formError} />
      <Field label="Current password" error={fieldErrors.current_password}>
        {(props) => <Input {...props} type="password" autoComplete="current-password" value={form.current_password} onChange={set('current_password')} error={fieldErrors.current_password} />}
      </Field>
      <Field label="New password" hint="At least 8 characters." error={fieldErrors.new_password}>
        {(props) => <Input {...props} type="password" autoComplete="new-password" value={form.new_password} onChange={set('new_password')} error={fieldErrors.new_password} />}
      </Field>
      <Field label="Confirm new password" error={fieldErrors.confirm}>
        {(props) => <Input {...props} type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={fieldErrors.confirm} />}
      </Field>
      <Button type="submit" variant="secondary" loading={change.isPending}>Change password</Button>
    </form>
  )
}

export default function Profile() {
  const { updateUser } = useAuth()
  const profile = useApiQuery(({ signal }) => api.get('/me/profile', { signal }), [])
  const categories = useApiQuery(({ signal }) => api.get('/categories', { signal }), [])
  const [current, setCurrent] = useState(null)

  useEffect(() => {
    if (profile.data) setCurrent(profile.data)
  }, [profile.data])

  let content
  if (profile.error) content = <ErrorState error={profile.error} onRetry={profile.refetch} title="Your profile could not be loaded" />
  else if (!current) content = <LoadingRegion label="Loading profile"><Skeleton className="h-72 w-full" /></LoadingRegion>
  else {
    content = (
      <>
        <Section title="Your details" description={`Member since ${formatDate(current.created_at)}.`}>
          <DetailsForm
            profile={current}
            categories={categories}
            onSaved={(data) => {
              setCurrent(data)
              updateUser({ full_name: data.full_name, preferred_categories: data.preferred_categories })
            }}
          />
        </Section>
        <Section title="Password" description="You will stay logged in on this device after changing it.">
          <PasswordForm />
        </Section>
      </>
    )
  }

  return (
    <div>
      <PageHeader title="Profile" description="Your name, interests and password." />
      {content}
    </div>
  )
}
