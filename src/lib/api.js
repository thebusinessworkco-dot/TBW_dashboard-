import { supabase } from './supabase.js'

// In Vercel deployment, frontend and serverless API are hosted on the exact same origin.
// Enforce same-origin relative API requests (/api/*) unconditionally.
export const API_BASE = ''

let isRefreshing = false

export async function apiRequest(endpoint, options = {}, isRetry = false) {
  const cleanEndpoint = endpoint.replace(/^https?:\/\/api\.thebusinesswork\.com/i, '')
  const url = cleanEndpoint.startsWith('http') ? cleanEndpoint : `${API_BASE}${cleanEndpoint}`
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers || {})
  }

  // Check if we have an in-memory/localStorage token
  const token = localStorage.getItem('tbw_token')
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include' // send HttpOnly cookies
  })

  let data
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    const error = new Error(data?.error?.message || `Request failed with status ${res.status}`)
    error.status = res.status
    error.code = data?.error?.code
    error.details = data?.error?.details

    // 401 Handling: Avoid loops and handle silent token refresh
    if (res.status === 401) {
      const isAuthEndpoint = endpoint.includes('/auth/login') || endpoint.includes('/auth/register')

      // Never trigger session expiration on login/registration failures
      if (!isAuthEndpoint) {
        // Attempt Supabase silent token refresh before invalidating session
        if (!isRetry && supabase && !isRefreshing) {
          isRefreshing = true
          try {
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
            if (!refreshError && refreshData?.session?.access_token) {
              const freshToken = refreshData.session.access_token
              localStorage.setItem('tbw_token', freshToken)
              window.__tbw_supabase_token = freshToken
              isRefreshing = false
              // Retry original request with fresh token
              return apiRequest(endpoint, {
                ...options,
                headers: { ...headers, Authorization: `Bearer ${freshToken}` }
              }, true)
            }
          } catch {
            // Refresh failed; proceed to session termination
          } finally {
            isRefreshing = false
          }
        }

        // Token is genuinely invalid and cannot be refreshed
        localStorage.removeItem('tbw_token')
        delete window.__tbw_supabase_token
        window.dispatchEvent(new CustomEvent('tbw_auth_expired', {
          detail: { code: data?.error?.code || 'UNAUTHORIZED' }
        }))
      }
    }

    throw error
  }

  return data
}

export const api = {
  get: (endpoint, options) => apiRequest(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options) => apiRequest(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),
  put: (endpoint, body, options) => apiRequest(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) }),
  patch: (endpoint, body, options) => apiRequest(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
  delete: (endpoint, options) => apiRequest(endpoint, { ...options, method: 'DELETE' }),
  getBaseUrl: () => API_BASE
}
