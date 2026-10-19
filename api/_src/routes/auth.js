import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { revokeToken } from '../_lib/auth.js'
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

    const userRes = await query(`
      SELECT id, email, password_hash, name, phone, role, avatar_url, is_active
      FROM public.users
      WHERE email = $1
      LIMIT 1
    `, [email])

    const user = userRes.rows[0]
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || ''
    const userAgent = req.headers['user-agent'] || ''

    if (!user) {
      await logAudit({
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
      await logAudit({
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
      await logAudit({
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

    // Generate secure session token
    const token = generateToken(32)
    const maxAgeHours = parseInt(process.env.SESSION_MAX_AGE_HOURS || '72', 10)
    const expiresAt = new Date(Date.now() + maxAgeHours * 60 * 60 * 1000).toISOString()

    await query(`
      INSERT INTO public.sessions (id, user_id, device_info, ip_address, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [token, user.id, userAgent.substring(0, 255), ipAddress, expiresAt])

    await query(`
      UPDATE public.users SET last_login_at = now() WHERE id = $1
    `, [user.id])

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

    await logAudit({
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
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await revokeToken(req.rawToken, req.user?.id)

    const clearOptions = { path: '/' }
    if (process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN) {
      clearOptions.domain = process.env.COOKIE_DOMAIN
    }
    res.clearCookie('tbw_session', clearOptions)

    await logAudit({
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

    const userRes = await query('SELECT password_hash FROM public.users WHERE id = $1', [req.user.id])
    const user = userRes.rows[0]

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found.' }
      })
    }

    const match = await bcrypt.compare(current_password, user.password_hash)
    if (!match) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PASSWORD', message: 'Current password does not match.' }
      })
    }

    const newHash = await bcrypt.hash(new_password, 12)
    await query('UPDATE public.users SET password_hash = $1, updated_at = now() WHERE id = $2', [newHash, req.user.id])

    // Invalidate old sessions upon password change
    await query('DELETE FROM public.sessions WHERE user_id = $1', [req.user.id])
    await revokeToken(req.rawToken, req.user.id)

    await logAudit({
      userId: req.user.id,
      action: 'auth.password_change',
      entityType: 'user',
      entityId: req.user.id,
      ipAddress: req.ip
    })

    res.json({
      success: true,
      message: 'Password updated successfully. Please log in again.'
    })
  } catch (err) {
    next(err)
  }
})

export default router
