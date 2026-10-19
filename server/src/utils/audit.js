import { getDb } from '../db/connection.js'
import { logger } from './logger.js'

export function logAudit({ userId = null, action, entityType, entityId = null, details = null, ipAddress = null }) {
  try {
    const db = getDb()
    const detailsJson = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null

    db.prepare(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      action,
      entityType,
      entityId,
      detailsJson,
      ipAddress
    )
  } catch (err) {
    logger.error('Failed to write audit log', { error: err.message, action, entityType })
  }
}
