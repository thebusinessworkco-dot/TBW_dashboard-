import { supabase } from './supabase.js'
import { api } from './api.js'

export async function cloudLogin(email, password) {
  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data?.session?.access_token) {
      throw new Error(error?.message || 'Login failed')
    }

    const token = data.session.access_token
    localStorage.setItem('tbw_token', token)
    window.__tbw_supabase_token = token

    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('This account cannot access the dashboard')
      const result = await response.json()
      if (!result?.success || !result?.data?.user) throw new Error('Invalid dashboard user response')
      return result.data.user
    } catch (err) {
      await supabase.auth.signOut().catch(() => {})
      localStorage.removeItem('tbw_token')
      throw err
    }
  }

  // Fallback to Express backend auth endpoint
  const res = await api.post('/api/auth/login', {
    email: email.trim().toLowerCase(),
    password
  })

  if (res.success && res.data) {
    if (res.data.token) {
      localStorage.setItem('tbw_token', res.data.token)
    }
    return res.data.user
  }

  throw new Error('Login failed. Please check your credentials.')
}

export async function cloudLogout() {
  const token = localStorage.getItem('tbw_token')
  try {
    if (token) {
      await api.post('/api/auth/logout').catch(() => {})
    }
    if (supabase) {
      await supabase.auth.signOut().catch(() => {})
    }
  } finally {
    localStorage.removeItem('tbw_token')
    delete window.__tbw_supabase_token
  }
}

export async function cloudFetch(path, options = {}) {
  let token = localStorage.getItem('tbw_token')
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    if (data?.session?.access_token) {
      token = data.session.access_token
    }
  }

  const headers = new Headers(options.headers || {})
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(path, { ...options, headers, credentials: 'same-origin' })
}
