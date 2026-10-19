import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { generateInvoicePdf } from '../services/pdf.js'
import { logAudit } from '../utils/audit.js'
import { createSignedExpiringToken, verifySignedExpiringToken } from '../utils/crypto.js'

const router = Router()

const invoiceItemSchema = z.object({
  description: z.string().min(1, 'Item description is required'),
  quantity: z.coerce.number().min(0.1).default(1),
  unit_price: z.coerce.number().min(0).default(0),
  sort_order: z.coerce.number().default(0)
})

const createInvoiceSchema = z.object({
  client_id: z.coerce.number().int(),
  quotation_id: z.coerce.number().int().optional().nullable(),
  project_id: z.coerce.number().int().optional().nullable(),
  issue_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  due_date: z.string().default(() => new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]),
  tax_type: z.enum(['none', 'cgst_sgst', 'igst']).default('none'),
  tax_rate: z.coerce.number().min(0).default(0),
  discount_type: z.enum(['fixed', 'percentage']).optional().nullable(),
  discount_value: z.coerce.number().min(0).default(0),
  notes: z.string().optional().default(''),
  terms: z.string().optional().default('Payment due within 14 days of invoice date.'),
  items: z.array(invoiceItemSchema).min(1, 'Invoice must have at least one line item')
})

const updateStatusSchema = z.object({
  status: z.enum(['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled', 'refunded'])
})

export function getNextInvoiceNumber(db) {
  const year = new Date().getFullYear()
  const prefix = `TBW-INV-${year}-`
  const latest = db.prepare(`
    SELECT invoice_number FROM invoices
    WHERE invoice_number LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(`${prefix}%`)

  let nextSeq = 1
  if (latest && latest.invoice_number) {
    const parts = latest.invoice_number.split('-')
    const lastNum = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(lastNum)) nextSeq = lastNum + 1
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`
}

// GET /api/invoices - List invoices with totals and client info
router.get('/', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const db = getDb()
    const { status, client_id, search } = req.query

    const conditions = []
    const params = []

    if (status) {
      conditions.push('inv.status = ?')
      params.push(status)
    }

    if (client_id) {
      conditions.push('inv.client_id = ?')
      params.push(parseInt(client_id, 10))
    }

    if (search) {
      conditions.push('(inv.invoice_number LIKE ? OR c.name LIKE ? OR c.business_name LIKE ?)')
      const pattern = `%${search}%`
      params.push(pattern, pattern, pattern)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const invoices = db.prepare(`
      SELECT
        inv.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        u.name as author_name,
        (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = inv.id) as item_count
      FROM invoices inv
      JOIN clients c ON inv.client_id = c.id
      LEFT JOIN users u ON inv.created_by = u.id
      ${whereClause}
      ORDER BY inv.created_at DESC
    `).all(...params)

    res.json({
      success: true,
      data: invoices
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/invoices/:id - Single invoice detail with line items and payments
router.get('/:id', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    const invoice = db.prepare(`
      SELECT
        inv.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        c.email as client_email,
        c.city as client_city,
        u.name as author_name
      FROM invoices inv
      JOIN clients c ON inv.client_id = c.id
      LEFT JOIN users u ON inv.created_by = u.id
      WHERE inv.id = ?
    `).get(id)

    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } })
    }

    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC, id ASC').all(id)
    const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC, id DESC').all(id)

    res.json({
      success: true,
      data: {
        ...invoice,
        items,
        payments
      }
    })
  } catch (err) {
    next(err)
  }
})

function streamInvoicePdf(id, res, next) {
  try {
    const db = getDb()
    const invoice = db.prepare(`
      SELECT
        inv.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        c.email as client_email,
        c.city as client_city
      FROM invoices inv
      JOIN clients c ON inv.client_id = c.id
      WHERE inv.id = ?
    `).get(id)

    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } })
    }

    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC, id ASC').all(id)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoice_number}.pdf"`)

    generateInvoicePdf({ ...invoice, items }, res)
  } catch (err) {
    next(err)
  }
}

// GET /api/invoices/:id/pdf - Stream PDF invoice (Supports authenticated user, token query param, or signed expiring exp_token)
router.get('/:id/pdf', (req, res, next) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid invoice ID' } })
  }

  // 1. Signed expiring token for public customer download
  if (req.query.exp_token) {
    const verified = verifySignedExpiringToken(req.query.exp_token, id)
    if (!verified) {
      return res.status(403).json({
        success: false,
        error: { code: 'INVALID_OR_EXPIRED_LINK', message: 'Invoice download link is invalid or has expired.' }
      })
    }
    return streamInvoicePdf(id, res, next)
  }

  // 2. Standard authentication (Bearer, Cookie, or query param token)
  requireAuth(req, res, () => {
    requireRole('accountant', 'sales', 'admin', 'owner')(req, res, () => {
      streamInvoicePdf(id, res, next)
    })
  })
})

// GET /api/invoices/:id/public-link - Generate a signed, 7-day expiring customer download URL
router.get('/:id/public-link', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()
    const invoice = db.prepare('SELECT id, invoice_number FROM invoices WHERE id = ?').get(id)
    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } })
    }

    const expToken = createSignedExpiringToken(String(id), 7 * 86400) // 7 days expiration
    const baseUrl = process.env.API_URL || `${req.protocol}://${req.get('host')}`
    const downloadUrl = `${baseUrl}/api/invoices/${id}/pdf?exp_token=${expToken}`

    res.json({
      success: true,
      data: {
        invoice_number: invoice.invoice_number,
        download_url: downloadUrl,
        expires_in_days: 7
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/invoices - Create new invoice
router.post('/', requireAuth, requireRole('accountant', 'admin', 'owner'), validate({ body: createInvoiceSchema }), (req, res, next) => {
  try {
    const db = getDb()
    const data = req.body

    const client = db.prepare('SELECT id, name FROM clients WHERE id = ?').get(data.client_id)
    if (!client) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Referenced client does not exist.' } })
    }

    const invoiceNumber = getNextInvoiceNumber(db)

    // Calculate subtotal
    let subtotal = 0
    for (const it of data.items) {
      subtotal += (Number(it.unit_price) || 0) * (Number(it.quantity) || 1)
    }

    let discount = 0
    if (data.discount_type === 'percentage') {
      discount = Math.round((subtotal * (Number(data.discount_value) || 0)) / 100)
    } else if (data.discount_type === 'fixed') {
      discount = Number(data.discount_value) || 0
    }

    const taxable = Math.max(0, subtotal - discount)
    const taxRate = (data.tax_type === 'cgst_sgst' || data.tax_type === 'igst') ? (Number(data.tax_rate) || 0) : 0
    const taxAmount = Math.round((taxable * taxRate) / 100)
    const total = taxable + taxAmount

    const createTx = db.transaction(() => {
      const invRes = db.prepare(`
        INSERT INTO invoices (
          invoice_number, client_id, quotation_id, project_id, created_by,
          status, issue_date, due_date, currency, tax_type, tax_rate,
          discount_type, discount_value, subtotal, tax_amount, total,
          amount_paid, balance_due, terms, notes
        ) VALUES (?, ?, ?, ?, ?, 'issued', ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        invoiceNumber,
        data.client_id,
        data.quotation_id || null,
        data.project_id || null,
        req.user.id,
        data.issue_date,
        data.due_date,
        data.tax_type || 'none',
        taxRate,
        data.discount_type || null,
        data.discount_value || 0,
        subtotal,
        taxAmount,
        total,
        total,
        data.terms,
        data.notes
      )

      const invoiceId = invRes.lastInsertRowid

      const insertItem = db.prepare(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      let order = 0
      for (const it of data.items) {
        const itemAmount = (Number(it.unit_price) || 0) * (Number(it.quantity) || 1)
        insertItem.run(invoiceId, it.description, it.quantity, it.unit_price, itemAmount, order++)
      }

      return invoiceId
    })

    const newInvoiceId = createTx()

    logAudit({
      userId: req.user.id,
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: newInvoiceId,
      details: { invoice_number: invoiceNumber, total, client_id: data.client_id },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: newInvoiceId,
        invoice_number: invoiceNumber,
        total,
        balance_due: total
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/invoices/:id/status - Update invoice status
router.patch('/:id/status', requireAuth, requireRole('accountant', 'admin', 'owner'), validate({ body: updateStatusSchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status } = req.body
    const db = getDb()

    db.prepare("UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
    res.json({ success: true, data: { id, status } })
  } catch (err) {
    next(err)
  }
})

// POST /api/invoices/:id/remind - Send payment reminder
router.post('/:id/remind', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    const invoice = db.prepare(`
      SELECT inv.*, c.name as client_name, c.whatsapp_phone as client_phone
      FROM invoices inv
      JOIN clients c ON inv.client_id = c.id
      WHERE inv.id = ?
    `).get(id)

    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } })
    }

    // Record reminder event in lead_events
    db.prepare(`
      INSERT INTO lead_events (client_id, event_type, description, user_id)
      VALUES (?, 'invoice_reminder', ?, ?)
    `).run(invoice.client_id, `Payment reminder sent for invoice ${invoice.invoice_number} (Balance: ₹${invoice.balance_due})`, req.user.id)

    logAudit({
      userId: req.user.id,
      action: 'invoice.reminded',
      entityType: 'invoice',
      entityId: id,
      details: { invoice_number: invoice.invoice_number, balance_due: invoice.balance_due },
      ipAddress: req.ip
    })

    res.json({
      success: true,
      message: `Payment reminder recorded for ${invoice.invoice_number}.`
    })
  } catch (err) {
    next(err)
  }
})

export default router
