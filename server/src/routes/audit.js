import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().optional(),
  entity_type: z.string().optional()
})

// GET /api/audit-log - Query audit logs with pagination and filters
router.get('/', requireAuth, validate({ query: auditQuerySchema }), (req, res, next) => {
  try {
    const { limit, offset, action, entity_type } = req.query
    const db = getDb()

    const conditions = []
    const params = []

    if (action) {
      conditions.push('a.action LIKE ?')
      params.push(`%${action}%`)
    }
    if (entity_type) {
      conditions.push('a.entity_type = ?')
      params.push(entity_type)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const totalCount = db.prepare(`
      SELECT COUNT(*) as c FROM audit_logs a ${whereClause}
    `).get(...params).c

    const logs = db.prepare(`
      SELECT
        a.id,
        a.user_id,
        u.name as user_name,
        u.email as user_email,
        a.action,
        a.entity_type,
        a.entity_id,
        a.details,
        a.ip_address,
        a.created_at
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)

    // Parse JSON details if stored as JSON string
    const formatted = logs.map(log => {
      let parsedDetails = log.details
      try {
        if (log.details && (log.details.startsWith('{') || log.details.startsWith('['))) {
          parsedDetails = JSON.parse(log.details)
        }
      } catch {
        parsedDetails = log.details
      }
      return {
        ...log,
        details: parsedDetails
      }
    })

    res.json({
      success: true,
      data: {
        total: totalCount,
        limit,
        offset,
        items: formatted,
        logs: formatted,
        pagination: {
          total: totalCount,
          limit,
          offset
        }
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
