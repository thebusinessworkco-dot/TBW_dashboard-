import { Router } from 'express'
import { z } from 'zod'
import { query, withTransaction } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { generatePaymentReceiptPdf } from '../services/pdf.js'
import { logAudit } from '../utils/audit.js'

const router = Router()

const createPaymentSchema = z.object({
  invoice_id: z.coerce.number().int().optional().nullable(),
  client_id: z.coerce.number().int(),
  amount: z.coerce.number().min(1, 'Amount must be greater than zero'),
  method: z.enum(['upi', 'bank_transfer', 'cash', 'cheque', 'gateway', 'other']).default('upi'),
  reference_id: z.string().optional().nullable(),
  payment_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  notes: z.string().optional().default('')
})

async function getNextReceiptNumber(client) {
  const year = new Date().getFullYear()
  const prefix = `TBW-RCP-${year}-`
  const latest = await client.query(`
    SELECT receipt_number FROM payments
    WHERE receipt_number LIKE $1
    ORDER BY id DESC LIMIT 1
  `, [`${prefix}%`])

  let nextSeq = 1
  if (latest.rows.length > 0 && latest.rows[0].receipt_number) {
    const parts = latest.rows[0].receipt_number.split('-')
    const lastNum = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(lastNum)) nextSeq = lastNum + 1
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`
}

// GET /api/payments - List payments
router.get('/', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const { invoice_id, client_id, method } = req.query
    const conditions = []
    const params = []

    if (invoice_id) {
      params.push(parseInt(invoice_id, 10))
      conditions.push(`p.invoice_id = $${params.length}`)
    }

    if (client_id) {
      params.push(parseInt(client_id, 10))
      conditions.push(`p.client_id = $${params.length}`)
    }

    if (method) {
      params.push(method)
      conditions.push(`p.method = $${params.length}`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const payments = await query(`
      SELECT
        p.*,
        c.name as client_name,
        c.business_name,
        inv.invoice_number,
        u.name as recorded_by_name
      FROM payments p
      JOIN clients c ON p.client_id = c.id
      LEFT JOIN invoices inv ON p.invoice_id = inv.id
      LEFT JOIN users u ON p.recorded_by = u.id
      ${whereClause}
      ORDER BY p.payment_date DESC, p.id DESC
    `, params)

    res.json({
      success: true,
      data: payments.rows
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/payments/:id/receipt - Stream PDF receipt
router.get('/:id/receipt', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const result = await query(`
      SELECT
        p.*,
        c.name as client_name,
        c.business_name,
        inv.invoice_number
      FROM payments p
      JOIN clients c ON p.client_id = c.id
      LEFT JOIN invoices inv ON p.invoice_id = inv.id
      WHERE p.id = $1
    `, [id])

    const payment = result.rows[0]
    if (!payment) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Payment not found.' } })
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${payment.receipt_number || 'receipt-' + id}.pdf"`)

    generatePaymentReceiptPdf(payment, res)
  } catch (err) {
    next(err)
  }
})

// POST /api/payments - Record a payment
router.post('/', requireAuth, requireRole('accountant', 'admin', 'owner'), validate({ body: createPaymentSchema }), async (req, res, next) => {
  try {
    const data = req.body

    const clientRes = await query('SELECT id, name FROM clients WHERE id = $1', [data.client_id])
    if (clientRes.rows.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Referenced client does not exist.' } })
    }

    let invoice = null
    if (data.invoice_id) {
      const invRes = await query('SELECT id, invoice_number, total, amount_paid, balance_due FROM invoices WHERE id = $1', [data.invoice_id])
      if (invRes.rows.length === 0) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Referenced invoice does not exist.' } })
      }
      invoice = invRes.rows[0]
    }

    const { paymentId, receiptNumber } = await withTransaction(async (client) => {
      const receiptNum = await getNextReceiptNumber(client)

      // 1. Insert payment record
      const payRes = await client.query(`
        INSERT INTO payments (
          invoice_id, client_id, amount, currency, method, reference_id,
          status, payment_date, notes, recorded_by, receipt_number
        ) VALUES ($1, $2, $3, 'INR', $4, $5, 'confirmed', $6, $7, $8, $9)
        RETURNING id
      `, [
        data.invoice_id || null,
        data.client_id,
        data.amount,
        data.method,
        data.reference_id || null,
        data.payment_date,
        data.notes || '',
        req.user.id,
        receiptNum
      ])

      const id = payRes.rows[0].id

      // 2. Update invoice balance and status if linked
      if (invoice) {
        const newPaid = Number(invoice.amount_paid) + Number(data.amount)
        const newBalance = Math.max(0, Number(invoice.total) - newPaid)
        const newStatus = newBalance <= 0 ? 'paid' : 'partially_paid'

        await client.query(`
          UPDATE invoices
          SET amount_paid = $1, balance_due = $2, status = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $4
        `, [newPaid, newBalance, newStatus, invoice.id])
      }

      // 3. Record timeline event
      await client.query(`
        INSERT INTO lead_events (client_id, event_type, to_value, description, user_id)
        VALUES ($1, 'payment_received', $2, $3, $4)
      `, [
        data.client_id,
        `₹${data.amount}`,
        `Payment of ₹${data.amount} received via ${data.method.toUpperCase()} (${receiptNum})`,
        req.user.id
      ])

      return { paymentId: id, receiptNumber: receiptNum }
    })

    logAudit({
      userId: req.user.id,
      action: 'payment.recorded',
      entityType: 'payment',
      entityId: paymentId,
      details: { receipt_number: receiptNumber, amount: data.amount, method: data.method },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: paymentId,
        receipt_number: receiptNumber,
        amount: data.amount,
        method: data.method,
        payment_date: data.payment_date
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
