import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { query, withTransaction } from '../_lib/db.js'
import { revokeToken, getAuthClient } from '../_lib/auth.js'
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

const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be 100 characters or fewer').trim(),
  phone: z.string().max(30).optional().nullable()
})

import { optionalEnv } from '../_lib/env.js'

// POST /api/auth/login
router.post('/login', loginLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { email, password } = req.body
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || ''
    const userAgent = req.headers['user-agent'] || ''

    const configuredOwnerUid = optionalEnv('TBW_OWNER_SUPABASE_UID', null)
    const configuredOwnerLegacyId = parseInt(optionalEnv('TBW_OWNER_LEGACY_ID', '1'), 10)

    let authenticatedUser = null
    let token = null
    let isSupabaseAuth = false

    // 1. PRIMARY: Authenticate via Supabase Auth
    const client = getAuthClient()
    if (client) {
      try {
        const { data: supaData, error: supaErr } = await client.auth.signInWithPassword({
          email,
          password
        })

        if (!supaErr && supaData?.user && supaData?.session) {
          const supabaseUid = supaData.user.id
          const supabaseEmail = supaData.user.email

          // Find mapped user in tbw_cloud.auth_links
          let linkRes = await query(`
            SELECT u.id, u.email, u.name, u.phone, u.role, u.avatar_url, u.is_active
            FROM public.users u
            JOIN tbw_cloud.auth_links link ON link.legacy_user_id = u.id
            WHERE link.supabase_user_id = $1::uuid
            LIMIT 1
          `, [supabaseUid])

          // If not in auth_links, check if it matches configured Owner UID (fails securely if configuredOwnerUid is missing)
          if (linkRes.rows.length === 0 && configuredOwnerUid && supabaseUid === configuredOwnerUid) {
            await withTransaction(async (client) => {
              const ownerCheck = await client.query(
                "SELECT id, email, role FROM public.users WHERE id = $1 AND role = 'owner'",
                [configuredOwnerLegacyId]
              )
              if (ownerCheck.rows.length === 0) {
                throw new Error(`Legacy owner user ${configuredOwnerLegacyId} not found with role 'owner'`)
              }

              const updateRes = await client.query(`
                UPDATE tbw_cloud.auth_links
                SET supabase_user_id = $1::uuid
                WHERE legacy_user_id = $2
                RETURNING supabase_user_id, legacy_user_id
              `, [supabaseUid, configuredOwnerLegacyId])

              if (updateRes.rows.length === 0) {
                await client.query(`
                  INSERT INTO tbw_cloud.auth_links (supabase_user_id, legacy_user_id)
                  VALUES ($1::uuid, $2)
                  ON CONFLICT (supabase_user_id) DO UPDATE SET legacy_user_id = $2
                `, [supabaseUid, configuredOwnerLegacyId])
              }
            })

            linkRes = await query(`
              SELECT u.id, u.email, u.name, u.phone, u.role, u.avatar_url, u.is_active
              FROM public.users u
              WHERE u.id = $1
              LIMIT 1
            `, [configuredOwnerLegacyId])
          }

          if (linkRes.rows.length > 0) {
            authenticatedUser = {
              ...linkRes.rows[0],
              email: supabaseEmail || linkRes.rows[0].email,
              supabase_uid: supabaseUid
            }
            token = supaData.session.access_token
            isSupabaseAuth = true
          }
        }
      } catch {
        // Supabase sign-in threw or timed out, continue to fallback check
      }
    }

    // 2. FALLBACK: Check PostgreSQL public.users with bcrypt (for legacy or offline accounts)
    if (!authenticatedUser) {
      const userRes = await query(`
        SELECT id, email, password_hash, name, phone, role, avatar_url, is_active
        FROM public.users
        WHERE email = $1
        LIMIT 1
      `, [email])

      const legacyUser = userRes.rows[0]
      if (legacyUser && legacyUser.password_hash) {
        const passwordMatch = await bcrypt.compare(password, legacyUser.password_hash)
        if (passwordMatch) {
          authenticatedUser = legacyUser
        }
      }
    }

    if (!authenticatedUser) {
      await logAudit({
        action: 'auth.login_failed',
        entityType: 'user',
        details: { email, reason: 'invalid_credentials' },
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

    if (!authenticatedUser.is_active) {
      await logAudit({
        userId: authenticatedUser.id,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: authenticatedUser.id,
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

    // Generate session token if not holding Supabase JWT
    const maxAgeHours = parseInt(process.env.SESSION_MAX_AGE_HOURS || '72', 10)
    if (!token) {
      token = generateToken(32)
      const expiresAt = new Date(Date.now() + maxAgeHours * 60 * 60 * 1000).toISOString()

      await query(`
        INSERT INTO public.sessions (id, user_id, device_info, ip_address, expires_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [token, authenticatedUser.id, userAgent.substring(0, 255), ipAddress, expiresAt])
    }

    await query(`
      UPDATE public.users SET last_login_at = now() WHERE id = $1
    `, [authenticatedUser.id])

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
      userId: authenticatedUser.id,
      action: 'auth.login_success',
      entityType: 'session',
      details: {
        email: authenticatedUser.email,
        role: authenticatedUser.role,
        auth_provider: isSupabaseAuth ? 'supabase_auth' : 'postgresql_bcrypt'
      },
      ipAddress
    })

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: authenticatedUser.id,
          email: authenticatedUser.email,
          name: authenticatedUser.name,
          phone: authenticatedUser.phone,
          role: authenticatedUser.role,
          avatar_url: authenticatedUser.avatar_url,
          supabase_uid: authenticatedUser.supabase_uid || undefined
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

// PUT /api/auth/profile
router.put('/profile', requireAuth, validate({ body: updateProfileSchema }), async (req, res, next) => {
  try {
    const { name, phone } = req.body

    const updateRes = await query(`
      UPDATE public.users
      SET name = $1,
          phone = CASE WHEN $2 IS NOT NULL THEN $2 ELSE phone END,
          updated_at = now()
      WHERE id = $3
      RETURNING id, email, name, phone, role, avatar_url, is_active
    `, [name, phone !== undefined ? phone : null, req.user.id])

    const updatedUser = updateRes.rows[0]
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found.' }
      })
    }

    // Sync metadata to Supabase Auth if linked
    if (req.user.supabase_uid) {
      try {
        const client = getAuthClient()
        if (client && req.rawToken && req.rawToken.split('.').length === 3) {
          const { createClient } = await import('@supabase/supabase-js')
          const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
          const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
          if (url && anonKey) {
            const userClient = createClient(url, anonKey, {
              auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
            })
            await userClient.auth.setSession({ access_token: req.rawToken, refresh_token: '' })
            await userClient.auth.updateUser({ data: { name, full_name: name } })
          }
        }
      } catch {}
    }

    await logAudit({
      userId: req.user.id,
      action: 'auth.profile_updated',
      entityType: 'user',
      entityId: req.user.id,
      details: { name: updatedUser.name, phone: updatedUser.phone },
      ipAddress: req.ip
    })

    res.json({
      success: true,
      message: 'Profile updated successfully.',
      data: {
        user: {
          ...updatedUser,
          supabase_uid: req.user.supabase_uid || undefined
        }
      }
    })
  } catch (err) {
    next(err)
  }
})

// PUT /api/auth/password
router.put('/password', requireAuth, validate({ body: changePasswordSchema }), async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body

    const userRes = await query('SELECT id, email, password_hash FROM public.users WHERE id = $1', [req.user.id])
    const user = userRes.rows[0]

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found.' }
      })
    }

    // 1. Verify current password via PostgreSQL bcrypt and/or Supabase Auth
    let verified = false
    let supabaseSession = null

    if (user.password_hash) {
      const match = await bcrypt.compare(current_password, user.password_hash)
      if (match) verified = true
    }

    const client = getAuthClient()
    const emailsToTry = [req.user.supabase_email, user.email, req.user.email].filter(Boolean)
    const uniqueEmails = [...new Set(emailsToTry)]

    if (client && !verified) {
      for (const candidateEmail of uniqueEmails) {
        try {
          const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
            email: candidateEmail,
            password: current_password
          })
          if (!signInError && signInData?.session) {
            verified = true
            supabaseSession = signInData.session
            break
          }
        } catch {}
      }
    }

    if (!verified) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PASSWORD', message: 'Current password does not match.' }
      })
    }

    // 2. Hash new password with bcrypt (work factor 12) and update PostgreSQL
    const newHash = await bcrypt.hash(new_password, 12)
    await query('UPDATE public.users SET password_hash = $1, updated_at = now() WHERE id = $2', [newHash, req.user.id])

    // 3. Update Supabase Auth if session exists
    if (client && supabaseSession) {
      try {
        const { createClient } = await import('@supabase/supabase-js')
        const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
        const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
        if (url && anonKey) {
          const authedClient = createClient(url, anonKey, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
          })
          await authedClient.auth.setSession(supabaseSession)
          await authedClient.auth.updateUser({ password: new_password })
        }
      } catch {}
    }

    // 4. Invalidate sessions and revoke token
    await query('DELETE FROM public.sessions WHERE user_id = $1', [req.user.id])
    if (req.rawToken) {
      await revokeToken(req.rawToken, req.user.id)
    }

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
