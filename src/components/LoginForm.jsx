import { useState } from 'react'
import { Logo } from './Brand'
import Icon from './Icon'
import { cloudLogin } from '../lib/cloud-auth'

export default function LoginForm({ onLoginSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return

    setLoading(true)
    setError(null)

    try {
      const user = await cloudLogin(email, password)
      onLoginSuccess(user)
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  const fillDevAdmin = () => {
    setEmail('admin@thebusinesswork.com')
    setPassword('admin123')
    setError(null)
  }

  return (
    <div className="signed-out">
      <div className="so-card">
        <Logo size={56} />
        <h2>The Business Work</h2>
        <p style={{ margin: '0 0 16px', fontSize: '13.5px', color: 'var(--muted)' }}>
          Internal Operating System &amp; WhatsApp Management
        </p>

        {error ? (
          <div style={{
            width: '100%',
            padding: '10px 14px',
            background: 'color-mix(in srgb, #ef4444 12%, var(--card))',
            border: '1px solid #ef4444',
            borderRadius: '12px',
            color: '#dc2626',
            fontSize: '13px',
            textAlign: 'left'
          }}>
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px' }}>
          <div style={{ textAlign: 'left' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)' }}>
              Work Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@thebusinesswork.com"
              required
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '14px',
                border: '1px solid var(--line-2)',
                background: 'var(--soft)',
                color: 'var(--ink)',
                fontSize: '14px',
                marginTop: '4px'
              }}
            />
          </div>

          <div style={{ textAlign: 'left' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '14px',
                border: '1px solid var(--line-2)',
                background: 'var(--soft)',
                color: 'var(--ink)',
                fontSize: '14px',
                marginTop: '4px'
              }}
            />
          </div>

          <button
            type="submit"
            className="btn solid lg block"
            disabled={loading}
            style={{ marginTop: '8px' }}
          >
            {loading ? 'Authenticating…' : 'Sign in to Dashboard'}
          </button>

          {import.meta.env.DEV ? (
            <button
              type="button"
              className="btn soft block"
              onClick={fillDevAdmin}
              style={{ fontSize: '12px', marginTop: '4px', opacity: 0.7 }}
            >
              Dev Only: Autofill Local Admin
            </button>
          ) : null}
        </form>
      </div>
    </div>
  )
}
