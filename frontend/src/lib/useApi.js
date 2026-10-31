import { useCallback, useEffect, useRef, useState } from 'react'
import { isCancel } from './api'

// useApiQuery(fetcher, deps) runs fetcher({ signal }) on mount and whenever deps change.
// A newer request aborts the older one, so a slow response never overwrites a newer one.
// fetcher returns { data, meta } (see lib/api.js).
export function useApiQuery(fetcher, deps) {
  const [state, setState] = useState({ data: undefined, meta: undefined, error: null, isLoading: true })
  const [reloadKey, setReloadKey] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ ...prev, error: null, isLoading: true }))
    fetcherRef.current({ signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setState({ data: result.data, meta: result.meta, error: null, isLoading: false })
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && !isCancel(error)) {
          setState((prev) => ({ ...prev, error, isLoading: false }))
        }
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey])

  const refetch = useCallback(() => setReloadKey((key) => key + 1), [])
  return { ...state, refetch }
}

// useApiMutation(fn) wraps a write. mutate() resolves to fn's result or rethrows the
// RequestError, and isPending lets forms disable their submit button.
export function useApiMutation(fn) {
  const [isPending, setPending] = useState(false)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const mutate = useCallback(async (...args) => {
    setPending(true)
    try {
      return await fnRef.current(...args)
    } finally {
      setPending(false)
    }
  }, [])

  return { mutate, isPending }
}
