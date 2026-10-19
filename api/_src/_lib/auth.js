import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { optionalEnv } from './env.js'
import { query, withTransaction } from './db.js'

let authClient = null

export function getAuthClient() {
  const candidateUrl = optionalEnv('VITE_SUPABASE_URL', optionalEnv('SUPABASE_URL', 'https://fbyyjmxrkizlpmxakkdo.supabase.co'))
  const url = (candidateUrl && candidateUrl.includes('fbyyjmxrkizlpmxakkdo'))
    ? candidateUrl
    : 'https://fbyyjmxrkizlpmxakkdo.supabase.co'

  const anonKey = optionalEnv(
    'SUPABASE_PUBLISHABLE_KEY',
    optionalEnv(
      'SUPABASE_ANON_KEY',
      optionalEnv(
        'VITE_SUPABASE_PUBLISHABLE_KEY',
        optionalEnv(
          'VITE_SUPABASE_ANON_KEY',
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZieXlqbXhya2l6bHBteGFra2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzOTgwODMsImV4cCI6MjEwNzk3NDA4M30.Z8gf8z4LUtvsRyNV8wLL6qGpqIozgpldGFF_giwT7Rg'
        )
      )
    )
  )

  if (!url || !anonKey) {
    return null
  }

  if (!authClient) {
    authClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    })
  }

  return authClient
}

/**
 * Hash token for secure revocation storage without storing full access tokens
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Server-side authentication: handles Supabase JWTs with owner UID mapping & immediate revocation,
 * and seamlessly supports opaque sessions for staging/test continuity.
 */
export async function authenticateToken(token) {
  if (!token || typeof token !== 'string' || token.length > 8192) {
    return { status: 401, error: 'UNAUTHORIZED', message: 'Missing or invalid token.' }
  }


  // 1. Check if token has been revoked
  const tokenHash = hashToken(token)
  try {
    const revokedRes = await query(
      'SELECT token_hash FROM tbw_cloud.revoked_tokens WHERE token_hash = $1 AND expires_at > now() LIMIT 1',
      [tokenHash]
    )
    if (revokedRes.rows.length > 0) {
      return { status: 401, error: 'INVALID_SESSION', message: 'Token has been revoked. Please log in again.' }
    }
  } catch {
    // If revoked_tokens table does not exist yet (during early migration), proceed safely
  }

  // 2. If token looks like a JWT (3 parts separated by dots), verify with Supabase Auth
  const isJwt = token.split('.').length === 3
  const client = getAuthClient()

  if (isJwt && client) {
    try {
      const { data, error } = await client.auth.getUser(token)
      if (error || !data?.user?.id) {
        return { status: 401, error: 'INVALID_SESSION', message: 'Invalid or expired Supabase token.' }
      }

      const supabaseUid = data.user.id
      const configuredOwnerUid = optionalEnv('TBW_OWNER_SUPABASE_UID', null)
      const configuredOwnerLegacyId = parseInt(optionalEnv('TBW_OWNER_LEGACY_ID', '1'), 10)

      // Query mapped user from tbw_cloud.auth_links
      let linkRes = await query(`
        SELECT u.id, u.email, u.name, u.phone, u.role, u.avatar_url, u.is_active
        FROM public.users u
        JOIN tbw_cloud.auth_links link ON link.legacy_user_id = u.id
        WHERE link.supabase_user_id = $1::uuid
        LIMIT 1
      `, [supabaseUid])

      // If mapped user not found, check if it matches configured Owner UID (fails securely if configuredOwnerUid is missing)
      if (linkRes.rows.length === 0 && configuredOwnerUid && supabaseUid === configuredOwnerUid) {
        // Atomic, guarded owner mapping update
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

      const user = linkRes.rows[0]
      if (!user) {
        return {
          status: 403,
          error: 'ACCESS_DENIED',
          message: 'Supabase account is not authorized or linked to an internal dashboard user.'
        }
      }

      if (!user.is_active) {
        return {
          status: 403,
          error: 'ACCOUNT_DISABLED',
          message: 'Your account has been deactivated. Contact an administrator.'
        }
      }

      return {
        status: 200,
        user: {
          id: user.id,
          email: data.user.email || user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          avatar_url: user.avatar_url,
          is_active: user.is_active,
          supabase_uid: supabaseUid,
          supabase_email: data.user.email || null
        },
        authType: 'supabase'
      }
    } catch (err) {
      console.error('Supabase token verification error:', err.message)
      return { status: 401, error: 'INVALID_SESSION', message: 'Failed to verify session with Supabase.' }
    }
  }

  // 3. Fallback: Check PostgreSQL sessions table (for legacy tokens or test sessions)
  try {
    const sessionRes = await query(`
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
      FROM public.sessions s
      JOIN public.users u ON s.user_id = u.id
      WHERE s.id = $1
      LIMIT 1
    `, [token])

    const record = sessionRes.rows[0]
    if (!record) {
      return { status: 401, error: 'INVALID_SESSION', message: 'Invalid or expired session. Please log in again.' }
    }

    if (new Date() > new Date(record.expires_at)) {
      await query('DELETE FROM public.sessions WHERE id = $1', [token])
      return { status: 401, error: 'SESSION_EXPIRED', message: 'Your session has expired. Please log in again.' }
    }

    if (!record.is_active) {
      return { status: 403, error: 'ACCOUNT_DISABLED', message: 'Your account has been deactivated.' }
    }

    return {
      status: 200,
      user: {
        id: record.user_id,
        email: record.email,
        name: record.name,
        phone: record.phone,
        role: record.role,
        avatar_url: record.avatar_url,
        is_active: record.is_active
      },
      sessionId: record.session_id,
      authType: 'session'
    }
  } catch (err) {
    console.error('Session lookup error:', err.message)
    return { status: 401, error: 'INVALID_SESSION', message: 'Session validation failed.' }
  }
}

export const authenticateUser = authenticateToken


/**
 * Revoke token immediately on server side
 */
export async function revokeToken(token, userId = null) {
  if (!token) return

  const isJwt = token.split('.').length === 3
  if (isJwt) {
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h retention
    try {
      await query(`
        INSERT INTO tbw_cloud.revoked_tokens (token_hash, user_id, expires_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (token_hash) DO UPDATE SET revoked_at = now()
      `, [tokenHash, userId, expiresAt])
    } catch (err) {
      console.warn('Could not record revoked token in tbw_cloud:', err.message)
    }
  } else {
    try {
      await query('DELETE FROM public.sessions WHERE id = $1', [token])
    } catch {}
  }
}
