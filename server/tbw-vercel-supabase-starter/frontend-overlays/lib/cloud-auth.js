import { supabase } from './supabase.js'

// Example only: adapt App.jsx and src/lib/api.js atomically, never switch production
// until ALL business endpoints have moved to /api and use Supabase JWT auth.
export async function cloudLogin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data?.session?.access_token) throw new Error(error?.message || 'Login failed')
  try {
    const response = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      credentials: 'same-origin',
    })
    if (!response.ok) throw new Error('This account cannot access the dashboard')
    const result = await response.json()
    if (!result?.success || !result?.data?.user) throw new Error('Invalid dashboard user response')
    return result.data.user
  } catch (error) {
    await supabase.auth.signOut()
    throw error
  }
}

export async function cloudLogout() {
  // Note: JWT already issued by Supabase can remain valid until expiry.
  // Server-side immediate revocation requires an additional denylist or opaque session layer.
  await supabase.auth.signOut()
}

export async function cloudFetch(path, options = {}) {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data?.session?.access_token) throw new Error('Please log in')
  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `Bearer ${data.session.access_token}`)
  return fetch(path, { ...options, headers, credentials: 'same-origin' })
}
