import { Link, NavLink, Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth, homeFor, afterLoginPath } from '../../context/AuthContext'
import { SiteHeader } from './SiteHeader'
import { Skeleton, LoadingRegion } from '../ui/States'

function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-rule">
      <div className="page flex flex-col gap-2 py-8 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between">
        <p>FeedbackAI, a DBMS course project. Brands, products and demo reviews are fictional.</p>
        <Link to="/explore" className="link">Explore products</Link>
      </div>
    </footer>
  )
}

export function CustomerLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}

export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="page flex h-16 items-center">
        <Link to="/" className="font-serif text-[22px] font-semibold tracking-[-0.01em] text-ink">FeedbackAI</Link>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

const ACCOUNT_LINKS = [
  { to: '/account', label: 'Overview', end: true },
  { to: '/account/feedback', label: 'My feedback' },
  { to: '/account/activity', label: 'Activity' },
  { to: '/account/profile', label: 'Profile' }
]

export function AccountLayout() {
  return (
    <div className="page py-8">
      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Account" className="-mx-4 overflow-x-auto border-b border-rule px-4 lg:mx-0 lg:border-b-0 lg:px-0">
          <ul className="flex gap-1 lg:flex-col">
            {ACCOUNT_LINKS.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) => [
                    'block whitespace-nowrap px-3 py-2 text-sm transition-colors',
                    'border-b-2 lg:rounded lg:border-b-0',
                    isActive
                      ? 'border-accent font-medium text-accent lg:bg-accent-soft'
                      : 'border-transparent text-ink hover:text-accent'
                  ].join(' ')}
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

function SessionCheck() {
  return (
    <LoadingRegion label="Checking your session">
      <div className="page space-y-4 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </LoadingRegion>
  )
}

// Navigation guard only; the API checks the role on every request.
export function ProtectedRoute({ role, children }) {
  const { user, status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <SessionCheck />
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  if (role && user.role !== role) return <Navigate to={homeFor(user)} replace />
  return children
}

// Login and register are for guests; a signed-in user goes on to ?next= or their home page.
export function GuestRoute({ children }) {
  const { user, status } = useAuth()
  const [params] = useSearchParams()
  if (status === 'loading') return <SessionCheck />
  if (user) return <Navigate to={afterLoginPath(params.get('next'), user)} replace />
  return children
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="title-page">{title}</h1>
        {description && <p className="mt-1 text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}
