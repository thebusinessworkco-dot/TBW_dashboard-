import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
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

function getNextReceiptNumber(db) {
  const year = new Date().getFullYear()
  const prefix = `TBW-RCP-${year}-`
  const latest = db.prepare(`
    SELECT receipt_number FROM payments
    WHERE receipt_number LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(`${prefix}%`)

  let nextSeq = 1
  if (latest && latest.receipt_number) {
    const parts = latest.receipt_number.split('-')
    const lastNum = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(lastNum)) nextSeq = lastNum + 1
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`
}

// GET /api/payments - List payments
router.get('/', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const db = getDb()
    const { invoice_id, client_id, method } = req.query

    const conditions = []
    const params = []

    if (invoice_id) {
      conditions.push('p.invoice_id = ?')
      params.push(parseInt(invoice_id, 10))
    }

    if (client_id) {
      conditions.push('p.client_id = ?')
      params.push(parseInt(client_id, 10))
    }

    if (method) {
      conditions.push('p.method = ?')
      params.push(method)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const payments = db.prepare(`
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
    `).all(...params)

    res.json({
      success: true,
      data: payments
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/payments/:id/receipt - Stream PDF receipt
router.get('/:id/receipt', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    const payment = db.prepare(`
      SELECT
        p.*,
        c.name as client_name,
        c.business_name,
        inv.invoice_number
      FROM payments p
      JOIN clients c ON p.client_id = c.id
      LEFT JOIN invoices inv ON p.invoice_id = inv.id
      WHERE p.id = ?
    `).get(id)

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
router.post('/', requireAuth, requireRole('accountant', 'admin', 'owner'), validate({ body: createPaymentSchema }), (req, res, next) => {
  try {
    const db = getDb()
    const data = req.body

    const client = db.prepare('SELECT id, name FROM clients WHERE id = ?').get(data.client_id)
    if (!client) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Referenced client does not exist.' } })
    }

    let invoice = null
    if (data.invoice_id) {
      invoice = db.prepare('SELECT id, invoice_number, total, amount_paid, balance_due FROM invoices WHERE id = ?').get(data.invoice_id)
      if (!invoice) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Referenced invoice does not exist.' } })
      }
    }

    const receiptNumber = getNextReceiptNumber(db)

    const recordTx = db.transaction(() => {
      // 1. Insert payment record
      const payRes = db.prepare(`
        INSERT INTO payments (
          invoice_id, client_id, amount, currency, method, reference_id,
          status, payment_date, notes, recorded_by, receipt_number
        ) VALUES (?, ?, ?, 'INR', ?, ?, 'confirmed', ?, ?, ?, ?)
      `).run(
        data.invoice_id || null,
        data.client_id,
        data.amount,
        data.method,
        data.reference_id || null,
        data.payment_date,
        data.notes || '',
        req.user.id,
        receiptNumber
      )

      const paymentId = payRes.lastInsertRowid

      // 2. Update invoice balance and status if linked
      if (invoice) {
        const newPaid = Number(invoice.amount_paid) + Number(data.amount)
        const newBalance = Math.max(0, Number(invoice.total) - newPaid)
        const newStatus = newBalance <= 0 ? 'paid' : 'partially_paid'

        db.prepare(`
          UPDATE invoices
          SET amount_paid = ?, balance_due = ?, status = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(newPaid, newBalance, newStatus, invoice.id)
      }

      // 3. Record timeline event
      db.prepare(`
        INSERT INTO lead_events (client_id, event_type, to_value, description, user_id)
        VALUES (?, 'payment_received', ?, ?, ?)
      `).run(
        data.client_id,
        `₹${data.amount}`,
        `Payment of ₹${data.amount} received via ${data.method.toUpperCase()} (${receiptNumber})`,
        req.user.id
      )

      return paymentId
    })

    const newPaymentId = recordTx()

    logAudit({
      userId: req.user.id,
      action: 'payment.recorded',
      entityType: 'payment',
      entityId: newPaymentId,
      details: { receipt_number: receiptNumber, amount: data.amount, method: data.method },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: newPaymentId,
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
