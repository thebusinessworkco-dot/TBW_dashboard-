import { getDb } from '../db/connection.js'

export function extractToken(req) {
  // 1. Authorization header (Bearer token) - Standard production authentication (CSRF-immune)
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim()
  }

  // 2. Cookie (HttpOnly tbw_session) with CSRF validation on state mutations
  if (req.cookies && req.cookies.tbw_session) {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const hasCustomHeader = req.headers['x-requested-with'] || req.headers['authorization']
      const origin = req.headers.origin || req.headers.referer
      if (!hasCustomHeader && !origin) {
        return null // Reject unverified ambient cookie on mutating requests (CSRF protection)
      }
    }
    return req.cookies.tbw_session
  }

  // 3. Query parameter for direct PDF streaming / authorized downloads
  if (req.query && (req.query.token || req.query.auth_token)) {
    return req.query.token || req.query.auth_token
  }

  return null
}

export function requireAuth(req, res, next) {
  const token = extractToken(req)

  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Please log in.'
      }
    })
  }

  const db = getDb()

  const record = db.prepare(`
    SELECT
      s.id AS session_id,
      s.expires_at,
      u.id AS user_id,
      u.email,
      u.name,
      u.phone,
      u.role,
      u.avatar_url,
      u.is_active
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).get(token)

  if (!record) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_SESSION',
        message: 'Invalid or expired session. Please log in again.'
      }
    })
  }

  // Check if session has expired
  const now = new Date()
  const expiresAt = new Date(record.expires_at)
  if (now > expiresAt) {
    // Delete expired session
    db.prepare('DELETE FROM sessions WHERE id = ?').run(token)
    res.clearCookie('tbw_session')
    return res.status(401).json({
      success: false,
      error: {
        code: 'SESSION_EXPIRED',
        message: 'Your session has expired. Please log in again.'
      }
    })
  }

  // Check if user is active
  if (!record.is_active) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'ACCOUNT_DISABLED',
        message: 'Your account has been deactivated. Contact an administrator.'
      }
    })
  }

  req.user = {
    id: record.user_id,
    email: record.email,
    name: record.name,
    phone: record.phone,
    role: record.role,
    avatar_url: record.avatar_url
  }
  req.sessionId = record.session_id

  next()
}

export function optionalAuth(req, res, next) {
  const token = extractToken(req)
  if (!token) {
    req.user = null
    return next()
  }

  try {
    const db = getDb()
    const record = db.prepare(`
      SELECT
        s.id AS session_id,
        s.expires_at,
        u.id AS user_id,
        u.email,
        u.name,
        u.phone,
        u.role,
        u.avatar_url,
        u.is_active
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.id = ?
    `).get(token)

    if (record && new Date() <= new Date(record.expires_at) && record.is_active) {
      req.user = {
        id: record.user_id,
        email: record.email,
        name: record.name,
        phone: record.phone,
        role: record.role,
        avatar_url: record.avatar_url
      }
      req.sessionId = record.session_id
    } else {
      req.user = null
    }
  } catch {
    req.user = null
  }

  next()
}
