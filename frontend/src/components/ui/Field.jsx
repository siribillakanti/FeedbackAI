import { useId } from 'react'

// Every control has a visible label. Hints and errors are tied to the control with
// aria-describedby, and an error sets aria-invalid.

const CONTROL = [
  'block w-full rounded border bg-surface px-3 text-[15px] text-ink transition-colors',
  'placeholder:text-ink-2/70 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
  'disabled:bg-paper-2 disabled:text-ink-2'
].join(' ')

function borderFor(error) {
  return error ? 'border-negative' : 'border-rule'
}

export function Field({ label, hint, error, optional, counter, children, className }) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
          {optional && <span className="ml-1.5 font-normal text-ink-2">(optional)</span>}
        </label>
        {counter}
      </div>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && !error && <p id={hintId} className="mt-1.5 text-[13px] leading-5 text-ink-2">{hint}</p>}
      {error && <p id={errorId} className="mt-1.5 text-[13px] leading-5 text-negative">{error}</p>}
    </div>
  )
}

export function Input({ error, className = '', ...props }) {
  return <input className={`${CONTROL} h-10 ${borderFor(error)} ${className}`} {...props} />
}

export function Textarea({ error, className = '', ...props }) {
  return <textarea className={`${CONTROL} py-2 leading-6 ${borderFor(error)} ${className}`} {...props} />
}

export function Select({ error, className = '', children, ...props }) {
  return (
    <select className={`${CONTROL} h-10 pr-8 ${borderFor(error)} ${className}`} {...props}>
      {children}
    </select>
  )
}

// Inline "label: control" select for toolbars (sort, filters).
export function InlineSelect({ label, value, onChange, options, className = '' }) {
  const id = useId()
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor={id} className="whitespace-nowrap text-sm text-ink-2">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded border border-rule bg-surface pl-2.5 pr-8 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

export function CharCounter({ length, max, min }) {
  const tooShort = min && length > 0 && length < min
  const tooLong = length > max
  return (
    <span className={`figure text-xs ${tooLong || tooShort ? 'text-negative' : 'text-ink-2'}`} aria-live="polite">
      {length} / {max}
    </span>
  )
}

export function Checkbox({ label, description, className = '', ...props }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2.5 ${className}`}>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 rounded-sm border-rule accent-accent"
        {...props}
      />
      <span className="text-sm leading-6">
        <span className="text-ink">{label}</span>
        {description && <span className="block text-[13px] leading-5 text-ink-2">{description}</span>}
      </span>
    </label>
  )
}

// Summary shown above a form when the server rejects it.
export function FormError({ error }) {
  if (!error) return null
  return (
    <div role="alert" className="rounded border border-negative/40 bg-negative-soft px-4 py-3 text-sm text-ink">
      {error.message}
    </div>
  )
}
