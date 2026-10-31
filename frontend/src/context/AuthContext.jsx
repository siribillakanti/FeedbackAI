import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, tokenStore } from '../lib/api'

const AuthContext = createContext(null)

// status: 'loading' while a stored token is being checked, then 'authenticated' or 'guest'.
// Role checks here are for navigation only; the backend enforces them on every route.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState(() => (tokenStore.get() ? 'loading' : 'guest'))

  const signOut = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    setStatus('guest')
  }, [])

  useEffect(() => {
    if (!tokenStore.get()) return undefined
    const controller = new AbortController()
    api.get('/auth/me', { signal: controller.signal })
      .then(({ data }) => {
        setUser(data)
        setStatus('authenticated')
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        // Only a rejected token ends the session; a network blip keeps it for the next try.
        if (err.status === 401) signOut()
        else setStatus('guest')
      })
    return () => controller.abort()
  }, [signOut])

  useEffect(() => {
    window.addEventListener('feedbackai:unauthorized', signOut)
    return () => window.removeEventListener('feedbackai:unauthorized', signOut)
  }, [signOut])

  const startSession = useCallback(({ user: nextUser, token }) => {
    tokenStore.set(token)
    setUser(nextUser)
    setStatus('authenticated')
    return nextUser
  }, [])

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    return startSession(data)
  }, [startSession])

  const register = useCallback(async (fields) => {
    const { data } = await api.post('/auth/register', fields)
    return startSession(data)
  }, [startSession])

  // Profile edits change the name shown in the header.
  const updateUser = useCallback((patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev)), [])

  const value = useMemo(
    () => ({ user, status, login, register, logout: signOut, updateUser }),
    [user, status, login, register, signOut, updateUser]
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}

// Where a signed-in user lands by default.
export const homeFor = (user) => (user && user.role === 'ADMIN' ? '/admin' : '/account')

// The ?next= target after login, limited to paths on this site (no "//host" redirects).
// A path for the other role is still caught by ProtectedRoute.
export function afterLoginPath(next, user) {
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') && !next.startsWith('/register')) {
    return next
  }
  return homeFor(user)
}
