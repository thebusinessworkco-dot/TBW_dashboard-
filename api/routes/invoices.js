import { Router } from 'express'
import { z } from 'zod'
import { query, withTransaction, getPool } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'
import { createSignedExpiringToken, verifySignedExpiringToken } from '../utils/crypto.js'
import { generateInvoicePdf } from '../services/pdf.js'

const router = Router()

const invoiceItemSchema = z.object({
  description: z.string().min(1, 'Item description is required'),
  quantity: z.coerce.number().min(0.01).default(1),
  unit_price: z.coerce.number().min(0).default(0)
})

const createInvoiceSchema = z.object({
  client_id: z.coerce.number().int({ message: 'Client ID is required' }),
  quotation_id: z.coerce.number().int().optional().nullable(),
  project_id: z.coerce.number().int().optional().nullable(),
  billing_address: z.string().optional().default(''),
  gstin: z.string().optional().default(''),
  issue_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  due_date: z.string().default(() => new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]),
  currency: z.string().default('INR'),
  tax_type: z.enum(['none', 'cgst_sgst', 'igst']).default('none'),
  tax_rate: z.coerce.number().min(0).default(0),
  discount_type: z.enum(['fixed', 'percentage']).optional().nullable(),
  discount_value: z.coerce.number().min(0).default(0),
  additional_charges: z.coerce.number().min(0).default(0),
  additional_charges_note: z.string().optional().default(''),
  payment_instructions: z.string().optional().default(''),
  terms: z.string().optional().default('Payment due within 14 days of invoice date.'),
  notes: z.string().optional().default(''),
  items: z.array(invoiceItemSchema).min(1, 'Invoice must have at least one line item')
})

const updateStatusSchema = z.object({
  status: z.enum(['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled', 'refunded'])
})

export async function getNextInvoiceNumber(clientOrPool = null) {
  const p = clientOrPool || getPool()
  const year = new Date().getFullYear()
  const prefix = `TBW-INV-${year}-`
  const latestRes = await p.query(`
    SELECT invoice_number FROM public.invoices
    WHERE invoice_number LIKE $1
    ORDER BY id DESC LIMIT 1
  `, [`${prefix}%`])

  let nextSeq = 1
  const latest = latestRes.rows[0]
  if (latest && latest.invoice_number) {
    const parts = latest.invoice_number.split('-')
    const lastNum = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(lastNum)) nextSeq = lastNum + 1
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`
}

async function streamInvoicePdf(id, res, next) {
  try {
    const invRes = await query(`
      SELECT
        inv.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        c.email as client_email,
        c.city as client_city
      FROM public.invoices inv
      JOIN public.clients c ON inv.client_id = c.id
      WHERE inv.id = $1
    `, [id])

    const invoice = invRes.rows[0]
    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } })
    }

    const itemsRes = await query(`
      SELECT * FROM public.invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC, id ASC
    `, [id])

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoice_number}.pdf"`)

    generateInvoicePdf({ ...invoice, items: itemsRes.rows }, res)
  } catch (err) {
    next(err)
  }
}

// GET /api/invoices - List invoices with totals and client info
router.get('/', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const { status, client_id, search } = req.query

    const conditions = []
    const params = []
    let pIdx = 1

    if (status) {
      conditions.push(`inv.status = $${pIdx++}`)
      params.push(status)
    }

    if (client_id) {
      conditions.push(`inv.client_id = $${pIdx++}`)
      params.push(parseInt(client_id, 10))
    }

    if (search) {
      conditions.push(`(inv.invoice_number ILIKE $${pIdx} OR c.name ILIKE $${pIdx} OR c.business_name ILIKE $${pIdx})`)
      params.push(`%${search}%`)
      pIdx++
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const listRes = await query(`
      SELECT
        inv.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone,
        (SELECT COUNT(*)::int FROM public.invoice_items it WHERE it.invoice_id = inv.id) as item_count,
        COALESCE((SELECT SUM(p.amount) FROM public.payments p WHERE p.invoice_id = inv.id AND p.status = 'confirmed'), 0) as total_collected
      FROM public.invoices inv
      JOIN public.clients c ON inv.client_id = c.id
      ${whereClause}
      ORDER BY inv.created_at DESC
    `, params)

    res.json({
      success: true,
      data: listRes.rows
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/invoices/:id/pdf - Stream PDF invoice
router.get('/:id/pdf', async (req, res, next) => {
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

  // 2. Standard authentication
  requireAuth(req, res, () => {
    requireRole('accountant', 'sales', 'admin', 'owner')(req, res, () => {
      streamInvoicePdf(id, res, next)
    })
  })
})

// GET /api/invoices/:id/public-link - Generate a signed, 7-day expiring download URL
router.get('/:id/public-link', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const invRes = await query('SELECT id, invoice_number FROM public.invoices WHERE id = $1', [id])
    const invoice = invRes.rows[0]
    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } })
    }

    const expToken = createSignedExpiringToken(String(id), 7 * 86400)
    const baseUrl = process.env.NODE_ENV === 'test'
      ? `${req.protocol}://${req.get('host')}`
      : (process.env.API_URL || `${req.protocol}://${req.get('host')}`)
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

// GET /api/invoices/:id - Single invoice detail
router.get('/:id', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const invRes = await query(`
      SELECT
        inv.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        c.email as client_email,
        c.city as client_city
      FROM public.invoices inv
      JOIN public.clients c ON inv.client_id = c.id
      WHERE inv.id = $1
    `, [id])

    const invoice = invRes.rows[0]
    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } })
    }

    const itemsRes = await query('SELECT * FROM public.invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC, id ASC', [id])
    const paymentsRes = await query('SELECT * FROM public.payments WHERE invoice_id = $1 ORDER BY payment_date DESC, id DESC', [id])

    res.json({
      success: true,
      data: {
        ...invoice,
        items: itemsRes.rows,
        payments: paymentsRes.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/invoices - Create new invoice
router.post('/', requireAuth, requireRole('accountant', 'admin', 'owner'), validate({ body: createInvoiceSchema }), async (req, res, next) => {
  try {
    const data = req.body

    const clientRes = await query('SELECT id, name FROM public.clients WHERE id = $1', [data.client_id])
    if (clientRes.rows.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Referenced client does not exist.' } })
    }

    const invoiceNumber = await getNextInvoiceNumber()

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
    const extraCharges = Number(data.additional_charges) || 0
    const total = taxable + taxAmount + extraCharges
    const balanceDue = total

    const newInvoiceId = await withTransaction(async (pgClient) => {
      const invRes = await pgClient.query(`
        INSERT INTO public.invoices (
          invoice_number, client_id, quotation_id, project_id, created_by,
          status, billing_address, gstin, issue_date, due_date, currency,
          tax_type, tax_rate, discount_type, discount_value, additional_charges,
          additional_charges_note, subtotal, tax_amount, total, amount_paid,
          balance_due, payment_instructions, terms, notes
        ) VALUES (
          $1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, 0,
          $20, $21, $22, $23
        ) RETURNING id
      `, [
        invoiceNumber,
        data.client_id,
        data.quotation_id || null,
        data.project_id || null,
        req.user.id,
        data.billing_address || '',
        data.gstin || '',
        data.issue_date,
        data.due_date,
        data.currency || 'INR',
        data.tax_type || 'none',
        taxRate,
        data.discount_type || null,
        discount,
        extraCharges,
        data.additional_charges_note || '',
        subtotal,
        taxAmount,
        total,
        balanceDue,
        data.payment_instructions || '',
        data.terms || '',
        data.notes || ''
      ])

      const invoiceId = invRes.rows[0].id

      let order = 0
      for (const it of data.items) {
        const itemAmount = (Number(it.unit_price) || 0) * (Number(it.quantity) || 1)
        await pgClient.query(`
          INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [invoiceId, it.description, it.quantity || 1, it.unit_price, itemAmount, order++])
      }

      return invoiceId
    })

    await logAudit({
      userId: req.user.id,
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: newInvoiceId,
      details: { invoice_number: invoiceNumber, client_id: data.client_id, total },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: newInvoiceId,
        invoice_number: invoiceNumber,
        total,
        balance_due: balanceDue,
        status: 'draft'
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/invoices/:id/status - Update invoice status
router.patch('/:id/status', requireAuth, requireRole('accountant', 'admin', 'owner'), validate({ body: updateStatusSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status } = req.body

    await query('UPDATE public.invoices SET status = $1, updated_at = now() WHERE id = $2', [status, id])
    res.json({ success: true, data: { id, status } })
  } catch (err) {
    next(err)
  }
})

// POST /api/invoices/:id/remind - Log payment reminder
router.post('/:id/remind', requireAuth, requireRole('accountant', 'sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const invRes = await query(`
      SELECT inv.*, c.name as client_name, c.whatsapp_phone
      FROM public.invoices inv
      JOIN public.clients c ON inv.client_id = c.id
      WHERE inv.id = $1
    `, [id])

    const invoice = invRes.rows[0]
    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } })
    }

    await logAudit({
      userId: req.user.id,
      action: 'invoice.reminder_sent',
      entityType: 'invoice',
      entityId: id,
      details: { invoice_number: invoice.invoice_number, client_name: invoice.client_name },
      ipAddress: req.ip
    })

    res.json({
      success: true,
      message: `Payment reminder logged for ${invoice.client_name} regarding Invoice ${invoice.invoice_number}.`
    })
  } catch (err) {
    next(err)
  }
})

export default router
