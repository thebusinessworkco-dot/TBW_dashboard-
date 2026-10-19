import { authenticateToken } from '../_lib/auth.js'

export function extractToken(req) {
  // 1. Authorization header (Bearer token) - Primary CSRF-immune method
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim()
  }

  // 2. Cookie (HttpOnly tbw_session) with CSRF validation on mutations
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

export async function requireAuth(req, res, next) {
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

  const result = await authenticateToken(token)

  if (result.status !== 200) {
    return res.status(result.status).json({
      success: false,
      error: {
        code: result.error,
        message: result.message
      }
    })
  }

  req.user = result.user
  req.authType = result.authType
  req.sessionId = result.sessionId || null
  req.rawToken = token

  next()
}

export async function optionalAuth(req, res, next) {
  const token = extractToken(req)
  if (!token) {
    req.user = null
    return next()
  }

  const result = await authenticateToken(token)
  if (result.status === 200) {
    req.user = result.user
    req.authType = result.authType
    req.sessionId = result.sessionId || null
    req.rawToken = token
  } else {
    req.user = null
  }

  next()
}
