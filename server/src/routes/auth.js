import { Router } from 'express'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import { generateToken } from '../utils/crypto.js'
import { logAudit } from '../utils/audit.js'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { loginLimiter } from '../middleware/rateLimit.js'

const router = Router()

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required')
})

const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8, 'New password must be at least 8 characters')
})

// POST /api/auth/login
router.post('/login', loginLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { email, password } = req.body
    const db = getDb()

    const user = db.prepare(`
      SELECT id, email, password_hash, name, phone, role, avatar_url, is_active
      FROM users
      WHERE email = ?
    `).get(email)

    const ipAddress = req.ip || req.connection?.remoteAddress
    const userAgent = req.headers['user-agent'] || ''

    if (!user) {
      logAudit({
        action: 'auth.login_failed',
        entityType: 'user',
        details: { email, reason: 'user_not_found' },
        ipAddress
      })
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.'
        }
      })
    }

    if (!user.is_active) {
      logAudit({
        userId: user.id,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        details: { email, reason: 'account_inactive' },
        ipAddress
      })
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_DISABLED',
          message: 'This account has been deactivated. Contact an administrator.'
        }
      })
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash)
    if (!passwordMatch) {
      logAudit({
        userId: user.id,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        details: { email, reason: 'invalid_password' },
        ipAddress
      })
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.'
        }
      })
    }

    // Generate secure session
    const token = generateToken(32)
    const maxAgeHours = parseInt(process.env.SESSION_MAX_AGE_HOURS || '72', 10)
    const expiresAt = new Date(Date.now() + maxAgeHours * 60 * 60 * 1000).toISOString()

    db.prepare(`
      INSERT INTO sessions (id, user_id, device_info, ip_address, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(token, user.id, userAgent.substring(0, 255), ipAddress, expiresAt)

    // Update last_login_at
    db.prepare(`
      UPDATE users SET last_login_at = datetime('now') WHERE id = ?
    `).run(user.id)

    // Set secure cookie
    const isProd = process.env.NODE_ENV === 'production'
    const cookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: maxAgeHours * 60 * 60 * 1000,
      path: '/'
    }
    if (isProd && process.env.COOKIE_DOMAIN) {
      cookieOptions.domain = process.env.COOKIE_DOMAIN
    }
    res.cookie('tbw_session', token, cookieOptions)

    logAudit({
      userId: user.id,
      action: 'auth.login_success',
      entityType: 'session',
      details: { email: user.email, role: user.role },
      ipAddress
    })

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          avatar_url: user.avatar_url
        }
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res, next) => {
  try {
    const db = getDb()
    if (req.sessionId) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId)
    }

    const clearOptions = { path: '/' }
    if (process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN) {
      clearOptions.domain = process.env.COOKIE_DOMAIN
    }
    res.clearCookie('tbw_session', clearOptions)

    logAudit({
      userId: req.user.id,
      action: 'auth.logout',
      entityType: 'session',
      ipAddress: req.ip
    })

    res.json({
      success: true,
      message: 'Logged out successfully.'
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user
    }
  })
})

// PUT /api/auth/password
router.put('/password', requireAuth, validate({ body: changePasswordSchema }), async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body
    const db = getDb()

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id)
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found.' }
      })
    }

    const matches = await bcrypt.compare(current_password, user.password_hash)
    if (!matches) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect.' }
      })
    }

    const newHash = await bcrypt.hash(new_password, 12)
    db.prepare(`
      UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?
    `).run(newHash, req.user.id)

    logAudit({
      userId: req.user.id,
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: req.user.id,
      ipAddress: req.ip
    })

    res.json({
      success: true,
      message: 'Password changed successfully.'
    })
  } catch (err) {
    next(err)
  }
})

export default router
