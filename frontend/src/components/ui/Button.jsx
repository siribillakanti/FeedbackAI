import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

const VARIANTS = {
  primary: 'bg-accent text-white hover:bg-accent-hover border border-accent hover:border-accent-hover',
  secondary: 'bg-surface text-ink border border-rule hover:border-ink-2',
  ghost: 'bg-transparent text-ink border border-transparent hover:bg-paper-2',
  danger: 'bg-negative text-white border border-negative hover:opacity-90'
}

const SIZES = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2'
}

function classes(variant, size, className) {
  return [
    'inline-flex items-center justify-center whitespace-nowrap rounded font-medium transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-60',
    VARIANTS[variant],
    SIZES[size],
    className
  ].filter(Boolean).join(' ')
}

export function Button({ variant = 'primary', size = 'md', loading = false, disabled, className, children, type = 'button', ...props }) {
  return (
    <button type={type} className={classes(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />}
      {children}
    </button>
  )
}

export function ButtonLink({ variant = 'primary', size = 'md', className, children, ...props }) {
  return (
    <Link className={classes(variant, size, className)} {...props}>
      {children}
    </Link>
  )
}
