import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Menu, Search, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { ButtonLink, Button } from '../ui/Button'

function SearchForm({ className = '', onSubmitted }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const current = location.pathname === '/explore' ? params.get('q') || '' : ''
  const [value, setValue] = useState(current)

  useEffect(() => setValue(current), [current])

  return (
    <form
      role="search"
      className={`relative ${className}`}
      onSubmit={(event) => {
        event.preventDefault()
        const q = value.trim()
        navigate(q ? `/explore?q=${encodeURIComponent(q)}` : '/explore')
        if (onSubmitted) onSubmitted()
      }}
    >
      <label htmlFor="site-search" className="sr-only">Search products</label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" />
      <input
        id="site-search"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search products or brands"
        maxLength={100}
        className="h-9 w-full rounded border border-rule bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-2 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </form>
  )
}

const navClass = ({ isActive }) =>
  `text-sm font-medium transition-colors ${isActive ? 'text-accent' : 'text-ink hover:text-accent'}`

function AccountActions({ onNavigate, stacked = false }) {
  const { user, status, logout } = useAuth()
  const navigate = useNavigate()
  const layout = stacked ? 'flex flex-col items-stretch gap-2' : 'flex items-center gap-2'

  if (status === 'loading') return <div className="h-9 w-32" aria-hidden="true" />

  if (!user) {
    return (
      <div className={layout}>
        <ButtonLink to="/login" variant="ghost" size="sm" onClick={onNavigate}>Log in</ButtonLink>
        <ButtonLink to="/register" size="sm" onClick={onNavigate}>Create account</ButtonLink>
      </div>
    )
  }

  const firstName = user.full_name.split(' ')[0]
  const home = user.role === 'ADMIN' ? '/admin' : '/account'
  return (
    <div className={layout}>
      <ButtonLink to={home} variant="ghost" size="sm" onClick={onNavigate}>
        {user.role === 'ADMIN' ? 'Admin' : `${firstName}'s account`}
      </ButtonLink>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          logout()
          if (onNavigate) onNavigate()
          navigate('/')
        }}
      >
        Log out
      </Button>
    </div>
  )
}

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setMenuOpen(false), [location.pathname, location.search])

  return (
    <header className="border-b border-rule bg-paper">
      <div className="page flex h-16 items-center gap-6">
        <Link to="/" className="font-serif text-[22px] font-semibold tracking-[-0.01em] text-ink">
          FeedbackAI
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-5 md:flex">
          <NavLink to="/explore" className={navClass}>Explore</NavLink>
        </nav>
        <SearchForm className="hidden max-w-sm flex-1 md:block" />
        <div className="ml-auto hidden md:block">
          <AccountActions />
        </div>
        <button
          type="button"
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded border border-rule text-ink md:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
        </button>
      </div>
      {menuOpen && (
        <div id="mobile-menu" className="border-t border-rule bg-paper md:hidden">
          <div className="page flex flex-col gap-4 py-4">
            <SearchForm onSubmitted={() => setMenuOpen(false)} />
            <nav aria-label="Main" className="flex flex-col gap-3">
              <NavLink to="/explore" className={navClass}>Explore products</NavLink>
            </nav>
            <AccountActions stacked onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}
    </header>
  )
}
