import { createClient } from '@supabase/supabase-js'
import { requiredEnv } from './env.js'
import { getPool } from './db.js'

let authClient
function getAuthClient() {
  if (!authClient) {
    authClient = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_PUBLISHABLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
    )
  }
  return authClient
}

export async function requireOwner(req) {
  const header = req.headers.authorization || ''
  const token = /^Bearer ([^\s]+)$/.exec(header)?.[1]
  if (!token || token.length > 8192) return { status: 401, error: 'UNAUTHORIZED' }

  // Server-side network verification. Never trust locally-decoded JWT data.
  const { data, error } = await getAuthClient().auth.getUser(token)
  if (error || !data?.user?.id) return { status: 401, error: 'INVALID_SESSION' }

  const ownerUid = requiredEnv('TBW_OWNER_SUPABASE_UID')
  const ownerId = Number(requiredEnv('TBW_OWNER_LEGACY_ID'))
  if (!Number.isSafeInteger(ownerId) || ownerId < 1) throw new Error('Invalid owner ID setting')
  if (data.user.id !== ownerUid) return { status: 403, error: 'ACCESS_DENIED' }

  // Assumes the migrated public.users schema and explicit link are already in place.
  // No owner account is created automatically.
  const result = await getPool().query(`
    SELECT u.id, u.email, u.name, u.phone, u.role, u.avatar_url, u.is_active
    FROM public.users AS u
    JOIN tbw_cloud.auth_links AS link ON link.legacy_user_id = u.id
    WHERE link.supabase_user_id = $1::uuid AND u.id = $2
    LIMIT 1
  `, [data.user.id, ownerId])
  const owner = result.rows[0]
  if (!owner || owner.role !== 'owner' || owner.is_active !== true) {
    return { status: 403, error: 'ACCESS_DENIED' }
  }
  return { status: 200, user: owner }
}
