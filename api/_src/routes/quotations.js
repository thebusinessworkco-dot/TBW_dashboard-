import { Router } from 'express'
import { z } from 'zod'
import { query, withTransaction, getPool } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'
import { generateToken, createSignedExpiringToken, verifySignedExpiringToken } from '../utils/crypto.js'
import { generateQuotationPdf } from '../services/pdf.js'
import { sendMetaTextMessage } from '../services/whatsapp.js'
import { getNextInvoiceNumber } from './invoices.js'

const router = Router()

const itemSchema = z.object({
  service_id: z.coerce.number().int().optional().nullable(),
  description: z.string().min(1, 'Item description is required'),
  quantity: z.coerce.number().min(0.1).default(1),
  setup_fee: z.coerce.number().min(0).default(0),
  monthly_fee: z.coerce.number().min(0).default(0)
})

const createQuotationSchema = z.object({
  client_id: z.coerce.number().int({ message: 'Client ID is required' }),
  package_type: z.string().default('Custom Automation Solution'),
  scope_of_work: z.string().optional().default(''),
  deliverables: z.string().optional().default(''),
  timeline: z.string().default('2-3 Weeks'),
  payment_milestones: z.string().optional().default(''),
  terms: z.string().optional().default(''),
  exclusions: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  discount_type: z.enum(['fixed', 'percentage']).optional().nullable(),
  discount_value: z.coerce.number().min(0).default(0),
  tax_type: z.enum(['none', 'cgst_sgst', 'igst']).default('none'),
  tax_rate: z.coerce.number().min(0).default(0),
  valid_until: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, 'Quotation must have at least one line item')
})

const updateStatusSchema = z.object({
  status: z.enum(['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'revised'])
})

const acceptSchema = z.object({
  accepted_by: z.string().min(2, 'Name is required to sign acceptance')
})

// Generate next sequential quotation number
export async function getNextQuoteNumber(clientOrPool = null) {
  const p = clientOrPool || getPool()
  const year = new Date().getFullYear()
  const prefix = `TBW-QT-${year}-`
  const latestRes = await p.query(`
    SELECT quotation_number FROM public.quotations
    WHERE quotation_number LIKE $1
    ORDER BY id DESC LIMIT 1
  `, [`${prefix}%`])

  let nextSeq = 1
  const latest = latestRes.rows[0]
  if (latest && latest.quotation_number) {
    const parts = latest.quotation_number.split('-')
    const lastNum = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(lastNum)) nextSeq = lastNum + 1
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`
}

// GET /api/quotations - List quotations with totals and client info
router.get('/', requireAuth, requireRole('sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const { status, client_id } = req.query

    const conditions = []
    const params = []
    let pIdx = 1

    if (status) {
      conditions.push(`q.status = $${pIdx++}`)
      params.push(status)
    }

    if (client_id) {
      conditions.push(`q.client_id = $${pIdx++}`)
      params.push(parseInt(client_id, 10))
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const quotesRes = await query(`
      SELECT
        q.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone,
        u.name as creator_name,
        COALESCE(
          (SELECT SUM(qi.setup_fee * qi.quantity) FROM public.quotation_items qi WHERE qi.quotation_id = q.id), 0
        ) as total_setup_fee,
        COALESCE(
          (SELECT SUM(qi.monthly_fee * qi.quantity) FROM public.quotation_items qi WHERE qi.quotation_id = q.id), 0
        ) as total_monthly_fee
      FROM public.quotations q
      JOIN public.clients c ON q.client_id = c.id
      LEFT JOIN public.users u ON q.created_by = u.id
      ${whereClause}
      ORDER BY q.created_at DESC
    `, params)

    res.json({
      success: true,
      data: quotesRes.rows
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/quotations/accept/:token - Public landing page or JSON representation
router.get('/accept/:token', async (req, res, next) => {
  try {
    const { token } = req.params

    const quoteRes = await query(`
      SELECT
        q.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        c.email as client_email,
        COALESCE((SELECT SUM(qi.setup_fee * qi.quantity) FROM public.quotation_items qi WHERE qi.quotation_id = q.id), 0) as total_setup_fee,
        COALESCE((SELECT SUM(qi.monthly_fee * qi.quantity) FROM public.quotation_items qi WHERE qi.quotation_id = q.id), 0) as total_monthly_fee
      FROM public.quotations q
      JOIN public.clients c ON q.client_id = c.id
      WHERE q.acceptance_token = $1
    `, [token])

    const quote = quoteRes.rows[0]
    if (!quote) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation link invalid or expired.' } })
    }

    const itemsRes = await query(`
      SELECT qi.*, s.name as service_name
      FROM public.quotation_items qi
      LEFT JOIN public.services s ON qi.service_id = s.id
      WHERE qi.quotation_id = $1
      ORDER BY qi.sort_order ASC, qi.id ASC
    `, [quote.id])

    const items = itemsRes.rows

    // If viewed by web browser (HTML Accept), return mobile responsive proposal page
    const acceptHeader = req.headers['accept'] || ''
    if (acceptHeader.includes('text/html') && !acceptHeader.includes('application/json')) {
      const isExpired = quote.valid_until && new Date() > new Date(quote.valid_until)

      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quotation #${quote.quotation_number} — The Business Work</title>
  <style>
    :root { --bg: #f8fafc; --card: #ffffff; --text: #0f172a; --sub: #475569; --line: #e2e8f0; --accent: #ff6b35; }
    body { margin: 0; padding: 24px 16px; background: var(--bg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--text); }
    .container { max-width: 620px; margin: 0 auto; background: var(--card); border-radius: 18px; border: 1px solid var(--line); box-shadow: 0 10px 30px rgba(0,0,0,0.06); padding: 28px; }
    .badge { display: inline-block; padding: 4px 10px; background: rgba(255,107,53,0.12); color: var(--accent); border-radius: 20px; font-size: 12px; font-weight: 700; }
    h1 { margin: 12px 0 4px; font-size: 22px; }
    .sub { color: var(--sub); font-size: 13.5px; margin-bottom: 20px; }
    .box { background: #f1f5f9; border-radius: 12px; padding: 16px; margin: 16px 0; font-size: 13.5px; }
    .row { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .row:last-child { margin-bottom: 0; }
    .total-row { font-size: 16px; font-weight: 800; border-top: 1px solid var(--line); padding-top: 8px; margin-top: 8px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; width: 100%; padding: 13px; background: var(--accent); color: #fff; text-decoration: none; border-radius: 12px; font-weight: 700; border: none; font-size: 14.5px; cursor: pointer; box-sizing: border-box; margin-top: 10px; }
    .btn.soft { background: #e2e8f0; color: #1e293b; }
    input { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--line); font-size: 14px; box-sizing: border-box; margin: 8px 0 14px; }
    .accepted-tag { background: #dcfce7; color: #15803d; border: 1px solid #86efac; border-radius: 10px; padding: 12px; text-align: center; font-weight: 700; }
  </style>
</head>
<body>
  <div class="container">
    <span class="badge">OFFICIAL PROPOSAL</span>
    <h1>The Business Work</h1>
    <div class="sub">Quotation #${quote.quotation_number} • Prepared for ${quote.client_name || 'Client'}</div>

    <div class="box">
      <div style="font-weight: 700; margin-bottom: 6px;">${quote.package_type || 'Custom Automation Solution'}</div>
      <div style="color: var(--sub); font-size: 13px;">${quote.scope_of_work || 'Automation solution architecture, WhatsApp bot, and CRM integration.'}</div>
    </div>

    <div class="box">
      <div class="row"><span>Timeline:</span><b>${quote.timeline || '2-3 Weeks'}</b></div>
      <div class="row"><span>Setup / One-time:</span><b>₹${Number(quote.total_setup_fee || 0).toLocaleString('en-IN')}</b></div>
      ${quote.total_monthly_fee > 0 ? `<div class="row"><span>Monthly Retainer:</span><b>₹${Number(quote.total_monthly_fee).toLocaleString('en-IN')}/mo</b></div>` : ''}
      <div class="row total-row"><span>Total Due:</span><span style="color: var(--accent);">₹${Number(quote.total_setup_fee || 0).toLocaleString('en-IN')}</span></div>
    </div>

    <a href="/api/quotations/accept/${token}/pdf" target="_blank" class="btn soft">📥 Download Official PDF</a>

    <div style="margin-top: 24px;">
      ${quote.status === 'accepted' || quote.status === 'converted' ? `
        <div class="accepted-tag">✓ Accepted on ${new Date(quote.accepted_at || Date.now()).toLocaleDateString('en-IN')} by ${quote.accepted_by || 'Client'}</div>
      ` : isExpired ? `
        <div style="background: #fee2e2; color: #b91c1c; border-radius: 10px; padding: 12px; text-align: center; font-weight: 700;">⚠ This quotation expired on ${quote.valid_until}. Please contact support.</div>
      ` : `
        <form method="POST" action="/api/quotations/accept/${token}" onsubmit="handleAccept(event)">
          <label style="font-size: 13px; font-weight: 700; color: var(--sub);">Sign Your Acceptance</label>
          <input type="text" id="signerName" name="accepted_by" placeholder="Enter your full name" required />
          <button type="submit" class="btn" id="acceptBtn">✓ Digitally Accept &amp; Sign Proposal</button>
        </form>
        <div id="msg" style="margin-top: 10px; font-size: 13.5px; text-align: center;"></div>
        <script>
          async function handleAccept(e) {
            e.preventDefault();
            const name = document.getElementById('signerName').value.trim();
            if (!name) return;
            const btn = document.getElementById('acceptBtn');
            btn.disabled = true;
            btn.innerText = 'Signing...';
            try {
              const res = await fetch('/api/quotations/accept/${token}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accepted_by: name })
              });
              const data = await res.json();
              if (res.ok && data.success) {
                document.getElementById('msg').innerHTML = '<span style="color: green; font-weight: 700;">✓ Quotation Accepted! Our team will contact you shortly.</span>';
                setTimeout(() => window.location.reload(), 1500);
              } else {
                document.getElementById('msg').innerHTML = '<span style="color: red;">' + (data?.error?.message || 'Acceptance failed') + '</span>';
                btn.disabled = false;
                btn.innerText = '✓ Digitally Accept & Sign Proposal';
              }
            } catch (err) {
              document.getElementById('msg').innerText = 'Connection error. Please try again.';
              btn.disabled = false;
            }
          }
        </script>
      `}
    </div>
  </div>
</body>
</html>`)
    }

    res.json({
      success: true,
      data: {
        ...quote,
        items
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/quotations/accept/:token - Public customer acceptance with replay protection
router.post('/accept/:token', validate({ body: acceptSchema }), async (req, res, next) => {
  try {
    const { token } = req.params
    const { accepted_by } = req.body

    const quoteRes = await query('SELECT id, quotation_number, client_id, status, accepted_at, accepted_by, valid_until FROM public.quotations WHERE acceptance_token = $1', [token])
    const quote = quoteRes.rows[0]

    if (!quote) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Quotation link invalid or expired.' }
      })
    }

    if (quote.valid_until) {
      const expiryDate = new Date(quote.valid_until)
      expiryDate.setHours(23, 59, 59, 999)
      if (Date.now() > expiryDate.getTime()) {
        return res.status(410).json({
          success: false,
          error: { code: 'QUOTATION_EXPIRED', message: 'This quotation expired on ' + quote.valid_until }
        })
      }
    }

    // Replay protection: if already accepted, return 409 with details
    if (quote.status === 'accepted') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'ALREADY_ACCEPTED',
          message: `This quotation was already accepted on ${quote.accepted_at} by ${quote.accepted_by}.`,
          details: { accepted_by: quote.accepted_by, accepted_at: quote.accepted_at }
        }
      })
    }

    await query(`
      UPDATE public.quotations
      SET status = 'accepted', accepted_by = $1, accepted_at = now(), updated_at = now()
      WHERE id = $2
    `, [accepted_by, quote.id])

    // Update client lead status to 'won'
    await query("UPDATE public.clients SET lifecycle_status = 'won', updated_at = now() WHERE id = $1", [quote.client_id])

    await query(`
      INSERT INTO public.lead_events (client_id, event_type, to_value, description)
      VALUES ($1, 'quotation_accepted', 'won', $2)
    `, [quote.client_id, `Quotation ${quote.quotation_number} accepted digitally by ${accepted_by}`])

    await logAudit({
      userId: null,
      action: 'quotation.accepted',
      entityType: 'quotation',
      entityId: quote.id,
      details: { quotation_number: quote.quotation_number, accepted_by },
      ipAddress: req.ip
    })

    res.json({
      success: true,
      message: `Thank you, ${accepted_by}! Quotation ${quote.quotation_number} has been officially accepted. Our onboarding team will contact you shortly.`,
      data: {
        quotation_number: quote.quotation_number,
        accepted_by,
        accepted_at: new Date().toISOString()
      }
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/quotations/accept/:token/pdf - Public PDF stream via acceptance token
router.get('/accept/:token/pdf', async (req, res, next) => {
  try {
    const { token } = req.params

    const quoteRes = await query(`
      SELECT
        q.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        c.email as client_email
      FROM public.quotations q
      JOIN public.clients c ON q.client_id = c.id
      WHERE q.acceptance_token = $1
    `, [token])

    const quotation = quoteRes.rows[0]
    if (!quotation) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation link invalid or expired.' } })
    }

    const itemsRes = await query(`
      SELECT qi.*, s.name as service_name
      FROM public.quotation_items qi
      LEFT JOIN public.services s ON qi.service_id = s.id
      WHERE qi.quotation_id = $1
      ORDER BY qi.sort_order ASC, qi.id ASC
    `, [quotation.id])

    quotation.items = itemsRes.rows

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="TheBusinessWork_Quotation_${quotation.quotation_number}.pdf"`)
    generateQuotationPdf(quotation, res)
  } catch (err) {
    next(err)
  }
})

// GET /api/quotations/:id - Single quotation detail
router.get('/:id', requireAuth, requireRole('sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const quoteRes = await query(`
      SELECT
        q.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        c.email as client_email,
        u.name as creator_name
      FROM public.quotations q
      JOIN public.clients c ON q.client_id = c.id
      LEFT JOIN public.users u ON q.created_by = u.id
      WHERE q.id = $1
    `, [id])

    const quotation = quoteRes.rows[0]
    if (!quotation) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation not found.' } })
    }

    const itemsRes = await query(`
      SELECT qi.*, s.name as service_name
      FROM public.quotation_items qi
      LEFT JOIN public.services s ON qi.service_id = s.id
      WHERE qi.quotation_id = $1
      ORDER BY qi.sort_order ASC, qi.id ASC
    `, [id])

    quotation.items = itemsRes.rows

    res.json({
      success: true,
      data: quotation
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/quotations - Create official quotation
router.post('/', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: createQuotationSchema }), async (req, res, next) => {
  try {
    const data = req.body

    const clientRes = await query('SELECT id, name, lifecycle_status FROM public.clients WHERE id = $1', [data.client_id])
    const client = clientRes.rows[0]
    if (!client) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Referenced client does not exist.' } })
    }

    const quoteNumber = await getNextQuoteNumber()
    const acceptanceToken = generateToken(24)

    const newQuoteId = await withTransaction(async (pgClient) => {
      const quoteRes = await pgClient.query(`
        INSERT INTO public.quotations (
          quotation_number, client_id, created_by, status, package_type,
          scope_of_work, deliverables, timeline, payment_milestones,
          terms, exclusions, notes, discount_type, discount_value,
          tax_type, tax_rate, currency, valid_until, acceptance_token
        ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'INR', $16, $17)
        RETURNING id
      `, [
        quoteNumber,
        data.client_id,
        req.user.id,
        data.package_type,
        data.scope_of_work || '',
        data.deliverables || '',
        data.timeline || '2-3 Weeks',
        data.payment_milestones || '',
        data.terms || '',
        data.exclusions || '',
        data.notes || '',
        data.discount_type || null,
        data.discount_value || 0,
        data.tax_type || 'none',
        data.tax_rate || 0,
        data.valid_until || null,
        acceptanceToken
      ])

      const quoteId = quoteRes.rows[0].id

      let order = 0
      for (const it of data.items) {
        await pgClient.query(`
          INSERT INTO public.quotation_items (
            quotation_id, service_id, description, quantity, unit_price,
            setup_fee, monthly_fee, sort_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          quoteId,
          it.service_id || null,
          it.description,
          it.quantity || 1,
          it.setup_fee || 0,
          it.setup_fee || 0,
          it.monthly_fee || 0,
          order++
        ])
      }

      // Update client status to proposal_sent if currently new_lead/contacted
      if (['new_lead', 'contacted', 'qualified'].includes(client.lifecycle_status)) {
        await pgClient.query("UPDATE public.clients SET lifecycle_status = 'proposal_sent', updated_at = now() WHERE id = $1", [data.client_id])
        await pgClient.query(`
          INSERT INTO public.lead_events (client_id, event_type, from_value, to_value, description, user_id)
          VALUES ($1, 'status_change', $2, 'proposal_sent', $3, $4)
        `, [data.client_id, client.lifecycle_status, `Quotation ${quoteNumber} created`, req.user.id])
      }

      return quoteId
    })

    await logAudit({
      userId: req.user.id,
      action: 'quotation.created',
      entityType: 'quotation',
      entityId: newQuoteId,
      details: { quotation_number: quoteNumber, client_id: data.client_id },
      ipAddress: req.ip
    })

    const baseUrl = process.env.API_URL || `${req.protocol}://${req.get('host')}`

    res.status(201).json({
      success: true,
      data: {
        id: newQuoteId,
        quotation_number: quoteNumber,
        acceptance_token: acceptanceToken,
        acceptance_url: `${baseUrl}/api/quotations/accept/${acceptanceToken}`
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/quotations/:id/status - Update status
router.patch('/:id/status', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: updateStatusSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status } = req.body

    await query('UPDATE public.quotations SET status = $1, updated_at = now() WHERE id = $2', [status, id])
    res.json({ success: true, data: { id, status } })
  } catch (err) {
    next(err)
  }
})

// POST /api/quotations/:id/convert - Convert accepted quote to Invoice + Project
router.post('/:id/convert', requireAuth, requireRole('sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const quoteId = parseInt(req.params.id, 10)

    const quoteRes = await query('SELECT * FROM public.quotations WHERE id = $1', [quoteId])
    const quote = quoteRes.rows[0]
    if (!quote) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation not found.' } })
    }

    const itemsRes = await query('SELECT * FROM public.quotation_items WHERE quotation_id = $1', [quoteId])
    const items = itemsRes.rows

    // Calculate invoice totals
    let subtotal = 0
    for (const it of items) {
      subtotal += (Number(it.setup_fee) || 0) * (Number(it.quantity) || 1)
    }

    let discount = 0
    if (quote.discount_type === 'percentage') {
      discount = Math.round((subtotal * (Number(quote.discount_value) || 0)) / 100)
    } else if (quote.discount_type === 'fixed') {
      discount = Number(quote.discount_value) || 0
    }

    const taxable = Math.max(0, subtotal - discount)
    const taxRate = (quote.tax_type === 'cgst_sgst' || quote.tax_type === 'igst') ? (Number(quote.tax_rate) || 0) : 0
    const taxAmount = Math.round((taxable * taxRate) / 100)
    const total = taxable + taxAmount

    const invNumber = await getNextInvoiceNumber()
    const today = new Date().toISOString().split('T')[0]
    const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const result = await withTransaction(async (pgClient) => {
      // 1. Create Invoice
      const invRes = await pgClient.query(`
        INSERT INTO public.invoices (
          invoice_number, client_id, quotation_id, created_by, status,
          issue_date, due_date, currency, tax_type, tax_rate,
          discount_type, discount_value, subtotal, tax_amount, total,
          balance_due
        ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, 'INR', $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id
      `, [
        invNumber,
        quote.client_id,
        quoteId,
        req.user.id,
        today,
        dueDate,
        quote.tax_type || 'none',
        taxRate,
        quote.discount_type,
        quote.discount_value,
        subtotal,
        taxAmount,
        total,
        total
      ])

      const invoiceId = invRes.rows[0].id

      // 2. Insert Invoice Items
      let order = 0
      for (const it of items) {
        const itemAmount = (Number(it.setup_fee) || 0) * (Number(it.quantity) || 1)
        await pgClient.query(`
          INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [invoiceId, it.description, it.quantity, it.setup_fee, itemAmount, order++])
      }

      // 3. Create Project
      const projRes = await pgClient.query(`
        INSERT INTO public.projects (
          title, client_id, quotation_id, invoice_id, assigned_to,
          status, budget, start_date, deliverables
        ) VALUES ($1, $2, $3, $4, $5, 'development', $6, $7, $8)
        RETURNING id
      `, [
        `${quote.package_type || 'Automation Project'} - ${invNumber}`,
        quote.client_id,
        quoteId,
        invoiceId,
        req.user.id,
        total,
        today,
        quote.deliverables || quote.scope_of_work
      ])

      return { invoiceId, projectId: projRes.rows[0].id, invoiceNumber: invNumber }
    })

    await logAudit({
      userId: req.user.id,
      action: 'quotation.converted',
      entityType: 'quotation',
      entityId: quoteId,
      details: result,
      ipAddress: req.ip
    })

    res.json({
      success: true,
      message: 'Quotation successfully converted to Invoice and Project.',
      data: result
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/quotations/:id/pdf - Stream quotation PDF
router.get('/:id/pdf', requireAuth, requireRole('sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const quoteRes = await query(`
      SELECT
        q.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        c.email as client_email
      FROM public.quotations q
      JOIN public.clients c ON q.client_id = c.id
      WHERE q.id = $1
    `, [id])

    const quotation = quoteRes.rows[0]
    if (!quotation) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation not found.' } })
    }

    const itemsRes = await query(`
      SELECT qi.*, s.name as service_name
      FROM public.quotation_items qi
      LEFT JOIN public.services s ON qi.service_id = s.id
      WHERE qi.quotation_id = $1
      ORDER BY qi.sort_order ASC, qi.id ASC
    `, [id])

    quotation.items = itemsRes.rows

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="TheBusinessWork_Quotation_${quotation.quotation_number}.pdf"`)
    generateQuotationPdf(quotation, res)
  } catch (err) {
    next(err)
  }
})

// POST /api/quotations/:id/send-whatsapp - Send quotation link via WhatsApp
router.post('/:id/send-whatsapp', requireAuth, requireRole('sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const quoteRes = await query(`
      SELECT q.*, c.name as client_name, c.whatsapp_phone
      FROM public.quotations q
      JOIN public.clients c ON q.client_id = c.id
      WHERE q.id = $1
    `, [id])

    const quote = quoteRes.rows[0]
    if (!quote) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation not found.' } })
    }

    if (!quote.whatsapp_phone) {
      return res.status(400).json({ success: false, error: { code: 'NO_PHONE', message: 'Client has no WhatsApp number on file.' } })
    }

    const baseUrl = process.env.API_URL || `${req.protocol}://${req.get('host')}`
    const proposalUrl = `${baseUrl}/api/quotations/accept/${quote.acceptance_token}`
    const message = `Hello ${quote.client_name}! Your official proposal from The Business Work is ready for review:\n\n📄 Quotation #: ${quote.quotation_number}\n📦 Solution: ${quote.package_type}\n\n👉 Review and sign digitally here:\n${proposalUrl}\n\nQuestions? Reply directly to this chat.`

    const waResult = await sendMetaTextMessage({ to: quote.whatsapp_phone, text: message })

    await query("UPDATE public.quotations SET status = 'sent', sent_at = now(), sent_via = 'whatsapp_direct', updated_at = now() WHERE id = $1", [id])

    res.json({
      success: true,
      message: 'Quotation proposal dispatched via WhatsApp.',
      data: {
        sent_to: quote.whatsapp_phone,
        status: waResult.success ? 'delivered' : 'pending_or_skipped',
        wa_result: waResult
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
