import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, afterLoginPath } from '../../context/AuthContext'
import { useApiMutation } from '../../lib/useApi'
import { Field, Input, FormError } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')
  const [form, setForm] = useState({ email: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const { mutate, isPending } = useApiMutation(login)

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  async function onSubmit(event) {
    event.preventDefault()
    const errors = {}
    if (!form.email.trim()) errors.email = 'Enter your email address'
    if (!form.password) errors.password = 'Enter your password'
    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length) return

    try {
      const user = await mutate(form.email.trim(), form.password)
      navigate(afterLoginPath(next, user), { replace: true })
    } catch (err) {
      setFieldErrors(err.fields)
      setFormError(err)
    }
  }

  return (
    <div className="panel p-6 sm:p-8">
      <h1 className="title-page">Log in</h1>
      <p className="mt-1 text-ink-2">
        {next ? 'Log in to continue.' : 'Welcome back. Log in to rate products and see your feedback.'}
      </p>
      <form className="mt-6 space-y-5" onSubmit={onSubmit} noValidate>
        <FormError error={formError} />
        <Field label="Email" error={fieldErrors.email}>
          {(props) => (
            <Input {...props} type="email" autoComplete="email" value={form.email} onChange={set('email')} error={fieldErrors.email} />
          )}
        </Field>
        <Field label="Password" error={fieldErrors.password}>
          {(props) => (
            <Input {...props} type="password" autoComplete="current-password" value={form.password} onChange={set('password')} error={fieldErrors.password} />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={isPending}>Log in</Button>
      </form>
      <p className="mt-6 border-t border-rule pt-5 text-sm text-ink-2">
        New to FeedbackAI?{' '}
        <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'} className="link">Create an account</Link>
      </p>
    </div>
  )
}
