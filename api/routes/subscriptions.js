import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'

const router = Router()

const createSubscriptionSchema = z.object({
  client_id: z.coerce.number().int(),
  name: z.string().min(1, 'Subscription name is required'),
  monthly_fee: z.coerce.number().min(0, 'Monthly fee cannot be negative'),
  billing_cycle: z.enum(['monthly', 'quarterly', 'annual']).default('monthly'),
  start_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  next_billing: z.string().optional().nullable(),
  contract_end: z.string().optional().nullable(),
  notes: z.string().optional().default('')
})

const updateStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'cancelled', 'expired'])
})

// GET /api/subscriptions - List subscriptions and metrics
router.get('/', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const { status, client_id } = req.query
    const conditions = []
    const params = []

    if (status) {
      params.push(status)
      conditions.push(`s.status = $${params.length}`)
    }

    if (client_id) {
      params.push(parseInt(client_id, 10))
      conditions.push(`s.client_id = $${params.length}`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const subs = await query(`
      SELECT
        s.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone
      FROM subscriptions s
      JOIN clients c ON s.client_id = c.id
      ${whereClause}
      ORDER BY s.next_billing ASC, s.id DESC
    `, params)

    const mrrRes = await query("SELECT COALESCE(SUM(monthly_fee), 0) as total FROM subscriptions WHERE status = 'active'")
    const mrr = Number(mrrRes.rows[0]?.total || 0)

    res.json({
      success: true,
      data: {
        mrr,
        items: subs.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/subscriptions - Create subscription
router.post('/', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), validate({ body: createSubscriptionSchema }), async (req, res, next) => {
  try {
    const data = req.body

    const clientRes = await query('SELECT id, name FROM clients WHERE id = $1', [data.client_id])
    if (clientRes.rows.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Client not found.' } })
    }

    // Default next_billing = start_date + 1 month if not supplied
    let nextBilling = data.next_billing
    if (!nextBilling) {
      const d = new Date(data.start_date)
      d.setMonth(d.getMonth() + 1)
      nextBilling = d.toISOString().split('T')[0]
    }

    const result = await query(`
      INSERT INTO subscriptions (
        client_id, name, billing_cycle, monthly_fee, start_date, next_billing, contract_end, status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
      RETURNING id
    `, [
      data.client_id,
      data.name,
      data.billing_cycle,
      data.monthly_fee,
      data.start_date,
      nextBilling,
      data.contract_end || null,
      data.notes || ''
    ])

    const subId = result.rows[0].id

    logAudit({
      userId: req.user.id,
      action: 'subscription.created',
      entityType: 'subscription',
      entityId: subId,
      details: { name: data.name, monthly_fee: data.monthly_fee, client_id: data.client_id },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: subId,
        ...data,
        next_billing: nextBilling,
        status: 'active'
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/subscriptions/:id/status - Update subscription status
router.patch('/:id/status', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), validate({ body: updateStatusSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status } = req.body

    await query("UPDATE subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [status, id])
    res.json({ success: true, data: { id, status } })
  } catch (err) {
    next(err)
  }
})

// POST /api/subscriptions/:id/renew - Advance billing cycle and renew
router.post('/:id/renew', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const subRes = await query('SELECT * FROM subscriptions WHERE id = $1', [id])
    const sub = subRes.rows[0]
    if (!sub) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subscription not found.' } })
    }

    // Advance next billing by 1 month (or quarter/annual)
    const currentNext = sub.next_billing ? new Date(sub.next_billing) : new Date()
    if (sub.billing_cycle === 'annual') {
      currentNext.setFullYear(currentNext.getFullYear() + 1)
    } else if (sub.billing_cycle === 'quarterly') {
      currentNext.setMonth(currentNext.getMonth() + 3)
    } else {
      currentNext.setMonth(currentNext.getMonth() + 1)
    }

    const newNextBilling = currentNext.toISOString().split('T')[0]

    await query(`
      UPDATE subscriptions
      SET next_billing = $1, status = 'active', updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [newNextBilling, id])

    res.json({
      success: true,
      message: 'Subscription renewed successfully.',
      data: {
        id,
        next_billing: newNextBilling,
        status: 'active'
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
