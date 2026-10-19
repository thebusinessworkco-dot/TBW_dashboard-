const API_BASE = import.meta.env.VITE_API_URL || ''

export async function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`
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

    // Handle session expiration
    if (res.status === 401 && (data?.error?.code === 'SESSION_EXPIRED' || data?.error?.code === 'INVALID_SESSION')) {
      localStorage.removeItem('tbw_token')
      window.dispatchEvent(new CustomEvent('tbw_auth_expired', { detail: { code: data?.error?.code } }))
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
