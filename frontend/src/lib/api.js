import axios from 'axios'

// Presentation scope (docs/00_DECISIONS.md §0): the JWT is kept in localStorage and sent
// as a Bearer header. The Vite proxy makes /api same-origin.
const TOKEN_KEY = 'feedbackai.token'

export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      // Private mode or blocked storage: the session lasts until the tab closes.
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      // Nothing stored.
    }
  }
}

// Every failed request rejects with this shape, whatever went wrong.
export class RequestError extends Error {
  constructor({ status, code, message, fields }) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields || {}
  }
}

const client = axios.create({ baseURL: '/api', timeout: 15000 })

client.interceptors.request.use((config) => {
  const token = tokenStore.get()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

function toRequestError(err) {
  if (axios.isCancel(err)) return err
  const response = err.response
  if (!response) {
    return new RequestError({
      status: 0,
      code: 'NETWORK',
      message: 'Could not reach the server. Check that the backend is running and try again.'
    })
  }
  const body = response.data && response.data.error
  return new RequestError({
    status: response.status,
    code: body ? body.code : 'HTTP_' + response.status,
    message: body ? body.message : 'Something went wrong. Please try again.',
    fields: body && body.fields
  })
}

// A 401 on an authenticated call means the token expired or was rejected. AuthContext
// listens for this event, drops the session, and protected routes send the user to login.
client.interceptors.response.use(
  (response) => response,
  (err) => {
    const error = toRequestError(err)
    if (error.status === 401 && err.config && err.config.headers.Authorization) {
      window.dispatchEvent(new Event('feedbackai:unauthorized'))
    }
    return Promise.reject(error)
  }
)

// Resolves to { data, meta } from the { success, data, meta } envelope.
async function call(method, url, { params, body, signal } = {}) {
  const response = await client.request({ method, url, params, data: body, signal })
  return { data: response.data.data, meta: response.data.meta }
}

export const api = {
  get: (url, options) => call('get', url, options),
  post: (url, body, options) => call('post', url, { ...options, body }),
  put: (url, body, options) => call('put', url, { ...options, body }),
  patch: (url, body, options) => call('patch', url, { ...options, body }),
  delete: (url, options) => call('delete', url, options)
}

export const isCancel = axios.isCancel
