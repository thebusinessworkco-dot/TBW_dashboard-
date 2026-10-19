import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().optional(),
  entity_type: z.string().optional()
})

// GET /api/audit-log - Query audit logs with pagination and filters
router.get('/', requireAuth, validate({ query: auditQuerySchema }), async (req, res, next) => {
  try {
    const { limit, offset, action, entity_type } = req.query

    const conditions = []
    const params = []
    let pIdx = 1

    if (action) {
      conditions.push(`a.action ILIKE $${pIdx++}`)
      params.push(`%${action}%`)
    }
    if (entity_type) {
      conditions.push(`a.entity_type = $${pIdx++}`)
      params.push(entity_type)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRes = await query(`
      SELECT COUNT(*)::int as c FROM public.audit_logs a ${whereClause}
    `, params)
    const totalCount = countRes.rows[0]?.c || 0

    const queryParams = [...params, limit, offset]
    const logsRes = await query(`
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
      FROM public.audit_logs a
      LEFT JOIN public.users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${pIdx++} OFFSET $${pIdx++}
    `, queryParams)

    const formatted = logsRes.rows.map(log => {
      let parsedDetails = log.details
      try {
        if (typeof log.details === 'string' && (log.details.startsWith('{') || log.details.startsWith('['))) {
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
