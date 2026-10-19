import { query } from '../_lib/db.js'
import { logger } from './logger.js'

export async function logAudit({ userId = null, action, entityType, entityId = null, details = null, ipAddress = null }) {
  try {
    const detailsJson = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null

    await query(`
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      userId,
      action,
      entityType,
      entityId,
      detailsJson,
      ipAddress
    ])
  } catch (err) {
    logger.error('Failed to write audit log to PostgreSQL', { error: err.message, action, entityType })
  }
}
