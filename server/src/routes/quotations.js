import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { generateToken } from '../utils/crypto.js'
import { generateQuotationPdf } from '../services/pdf.js'
import { sendMetaTextMessage } from '../services/whatsapp.js'
import { logAudit } from '../utils/audit.js'
import { getNextInvoiceNumber } from './invoices.js'

const router = Router()

const itemSchema = z.object({
  service_id: z.coerce.number().optional().nullable(),
  description: z.string().min(1, 'Item description is required'),
  quantity: z.coerce.number().min(0.1).default(1),
  setup_fee: z.coerce.number().min(0).default(0),
  monthly_fee: z.coerce.number().min(0).default(0),
  sort_order: z.coerce.number().default(0)
})

const createQuotationSchema = z.object({
  client_id: z.coerce.number().int(),
  package_type: z.string().default('Custom Automation Solution'),
  scope_of_work: z.string().optional().default(''),
  deliverables: z.string().optional().default(''),
  timeline: z.string().optional().default('2-3 Weeks'),
  payment_milestones: z.string().optional().default('50% Upfront, 50% upon deployment'),
  terms: z.string().optional().default('Quotation valid for 14 days from issue date. Meta messaging charges billed at actuals.'),
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
function getNextQuoteNumber(db) {
  const year = new Date().getFullYear()
  const prefix = `TBW-QT-${year}-`
  const latest = db.prepare(`
    SELECT quotation_number FROM quotations
    WHERE quotation_number LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(`${prefix}%`)

  let nextSeq = 1
  if (latest && latest.quotation_number) {
    const parts = latest.quotation_number.split('-')
    const lastNum = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(lastNum)) nextSeq = lastNum + 1
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`
}

// GET /api/quotations - List quotations with totals and client info
router.get('/', requireAuth, requireRole('sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const db = getDb()
    const { status, client_id } = req.query

    const conditions = []
    const params = []

    if (status) {
      conditions.push('q.status = ?')
      params.push(status)
    }

    if (client_id) {
      conditions.push('q.client_id = ?')
      params.push(parseInt(client_id, 10))
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const quotes = db.prepare(`
      SELECT
        q.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        u.name as author_name,
        (SELECT COUNT(*) FROM quotation_items qi WHERE qi.quotation_id = q.id) as item_count,
        (SELECT SUM(qi.quantity * qi.setup_fee) FROM quotation_items qi WHERE qi.quotation_id = q.id) as total_setup_fee,
        (SELECT SUM(qi.quantity * qi.monthly_fee) FROM quotation_items qi WHERE qi.quotation_id = q.id) as total_monthly_fee
      FROM quotations q
      JOIN clients c ON q.client_id = c.id
      LEFT JOIN users u ON q.created_by = u.id
      ${whereClause}
      ORDER BY q.created_at DESC
    `).all(...params)

    res.json({
      success: true,
      data: quotes
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/quotations/accept/:token/pdf - Public PDF download for customer via acceptance token
router.get('/accept/:token/pdf', (req, res, next) => {
  try {
    const { token } = req.params
    const db = getDb()

    const quote = db.prepare(`
      SELECT
        q.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        c.email as client_email,
        c.city as client_city
      FROM quotations q
      JOIN clients c ON q.client_id = c.id
      WHERE q.acceptance_token = ?
    `).get(token)

    if (!quote) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation link invalid or expired.' } })
    }

    if (quote.valid_until) {
      const expiryDate = new Date(quote.valid_until)
      expiryDate.setHours(23, 59, 59, 999)
      if (Date.now() > expiryDate.getTime()) {
        return res.status(410).json({ success: false, error: { code: 'QUOTATION_EXPIRED', message: 'This quotation has expired.' } })
      }
    }

    const items = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order ASC, id ASC').all(quote.id)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${quote.quotation_number}.pdf"`)

    generateQuotationPdf({ ...quote, items }, res)
  } catch (err) {
    next(err)
  }
})

// GET /api/quotations/accept/:token - Public acceptance page data (JSON or Mobile HTML)
router.get('/accept/:token', (req, res, next) => {
  try {
    const { token } = req.params
    const db = getDb()

    const quote = db.prepare(`
      SELECT q.*, c.name as client_name, c.business_name, c.whatsapp_phone as client_phone
      FROM quotations q
      JOIN clients c ON q.client_id = c.id
      WHERE q.acceptance_token = ?
    `).get(token)

    if (!quote) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation link invalid or expired.' } })
    }

    // Expiry check
    const isExpired = quote.valid_until && (Date.now() > new Date(quote.valid_until).setHours(23, 59, 59, 999))
    if (isExpired && (!req.headers.accept || !req.headers.accept.includes('text/html'))) {
      return res.status(410).json({
        success: false,
        error: { code: 'QUOTATION_EXPIRED', message: 'This quotation has expired. Please contact The Business Work for an updated proposal.' }
      })
    }

    const items = db.prepare(`
      SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order ASC, id ASC
    `).all(quote.id)

    // If browser navigates directly from WhatsApp, render a branded mobile proposal view
    if (req.headers.accept && req.headers.accept.includes('text/html') && !req.query.json) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Quotation ${quote.quotation_number} — The Business Work</title>
  <style>
    :root { --accent: #ff6b35; --bg: #f8fafc; --card: #ffffff; --text: #0f172a; --sub: #64748b; --line: #e2e8f0; --green: #16a34a; }
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
router.post('/accept/:token', validate({ body: acceptSchema }), (req, res, next) => {
  try {
    const { token } = req.params
    const { accepted_by } = req.body
    const db = getDb()

    const quote = db.prepare('SELECT id, client_id, quotation_number, status, valid_until, accepted_at, accepted_by FROM quotations WHERE acceptance_token = ?').get(token)
    if (!quote) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation not found.' } })
    }

    // Expiry check
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

    const client = db.prepare('SELECT name FROM clients WHERE id = ?').get(quote.client_id)

    db.prepare(`
      UPDATE quotations
      SET status = 'accepted', accepted_by = ?, accepted_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(accepted_by, quote.id)

    // Update client lead status to 'won'
    db.prepare("UPDATE clients SET lifecycle_status = 'won', updated_at = datetime('now') WHERE id = ?").run(quote.client_id)

    db.prepare(`
      INSERT INTO lead_events (client_id, event_type, to_value, description)
      VALUES (?, 'quotation_accepted', 'won', ?)
    `).run(quote.client_id, `Quotation ${quote.quotation_number} accepted digitally by ${accepted_by}`)

    logAudit({
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

// GET /api/quotations/:id - Single quotation detail
router.get('/:id', requireAuth, requireRole('sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    const quote = db.prepare(`
      SELECT
        q.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        c.email as client_email,
        c.city as client_city,
        u.name as author_name
      FROM quotations q
      JOIN clients c ON q.client_id = c.id
      LEFT JOIN users u ON q.created_by = u.id
      WHERE q.id = ?
    `).get(id)

    if (!quote) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation not found.' } })
    }

    const items = db.prepare(`
      SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order ASC, id ASC
    `).all(id)

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

// GET /api/quotations/:id/pdf - Stream PDF document
router.get('/:id/pdf', requireAuth, requireRole('sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    const quote = db.prepare(`
      SELECT
        q.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        c.email as client_email,
        c.city as client_city
      FROM quotations q
      JOIN clients c ON q.client_id = c.id
      WHERE q.id = ?
    `).get(id)

    if (!quote) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation not found.' } })
    }

    const items = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order ASC, id ASC').all(id)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${quote.quotation_number}.pdf"`)

    generateQuotationPdf({ ...quote, items }, res)
  } catch (err) {
    next(err)
  }
})

// POST /api/quotations - Create quotation
router.post('/', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: createQuotationSchema }), (req, res, next) => {
  try {
    const db = getDb()
    const data = req.body

    const client = db.prepare('SELECT id, name, lifecycle_status FROM clients WHERE id = ?').get(data.client_id)
    if (!client) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Referenced client does not exist.' } })
    }

    const quoteNumber = getNextQuoteNumber(db)
    const acceptanceToken = generateToken(24)

    const createTransaction = db.transaction((d) => {
      const quoteResult = db.prepare(`
        INSERT INTO quotations (
          quotation_number, client_id, created_by, status, package_type,
          scope_of_work, deliverables, timeline, payment_milestones,
          terms, exclusions, notes, discount_type, discount_value,
          tax_type, tax_rate, currency, valid_until, acceptance_token
        ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?)
      `).run(
        quoteNumber,
        d.client_id,
        req.user.id,
        d.package_type,
        d.scope_of_work || '',
        d.deliverables || '',
        d.timeline || '2-3 Weeks',
        d.payment_milestones || '',
        d.terms || '',
        d.exclusions || '',
        d.notes || '',
        d.discount_type || null,
        d.discount_value || 0,
        d.tax_type || 'none',
        d.tax_rate || 0,
        d.valid_until || null,
        acceptanceToken
      )

      const quoteId = quoteResult.lastInsertRowid

      const insertItem = db.prepare(`
        INSERT INTO quotation_items (
          quotation_id, service_id, description, quantity, unit_price,
          setup_fee, monthly_fee, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)

      let order = 0
      for (const it of d.items) {
        insertItem.run(
          quoteId,
          it.service_id || null,
          it.description,
          it.quantity || 1,
          it.setup_fee || 0,
          it.setup_fee || 0,
          it.monthly_fee || 0,
          order++
        )
      }

      // Update client status to proposal_sent if currently new_lead/contacted
      if (['new_lead', 'contacted', 'qualified'].includes(client.lifecycle_status)) {
        db.prepare("UPDATE clients SET lifecycle_status = 'proposal_sent', updated_at = datetime('now') WHERE id = ?").run(d.client_id)
        db.prepare("INSERT INTO lead_events (client_id, event_type, from_value, to_value, description, user_id) VALUES (?, 'status_change', ?, 'proposal_sent', ?, ?)")
          .run(d.client_id, client.lifecycle_status, `Quotation ${quoteNumber} created`, req.user.id)
      }

      return quoteId
    })

    const newQuoteId = createTransaction(data)

    logAudit({
      userId: req.user.id,
      action: 'quotation.created',
      entityType: 'quotation',
      entityId: newQuoteId,
      details: { quotation_number: quoteNumber, client_id: data.client_id },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: newQuoteId,
        quotation_number: quoteNumber,
        acceptance_token: acceptanceToken,
        acceptance_url: `${process.env.API_URL || 'http://localhost:3001'}/api/quotations/accept/${acceptanceToken}`
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/quotations/:id/status - Update status
router.patch('/:id/status', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: updateStatusSchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status } = req.body
    const db = getDb()

    db.prepare("UPDATE quotations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
    res.json({ success: true, data: { id, status } })
  } catch (err) {
    next(err)
  }
})

// POST /api/quotations/:id/convert - Convert accepted quote to Invoice + Project
router.post('/:id/convert', requireAuth, requireRole('sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const quoteId = parseInt(req.params.id, 10)
    const db = getDb()

    const quote = db.prepare('SELECT * FROM quotations WHERE id = ?').get(quoteId)
    if (!quote) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation not found.' } })
    }

    const items = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(quoteId)

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

    const invNumber = getNextInvoiceNumber(db)
    const today = new Date().toISOString().split('T')[0]
    const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const convertTx = db.transaction(() => {
      // 1. Create Invoice
      const invRes = db.prepare(`
        INSERT INTO invoices (
          invoice_number, client_id, quotation_id, created_by, status,
          issue_date, due_date, currency, tax_type, tax_rate,
          discount_type, discount_value, subtotal, tax_amount, total,
          balance_due
        ) VALUES (?, ?, ?, ?, 'draft', ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
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
      )

      const invoiceId = invRes.lastInsertRowid

      // 2. Insert Invoice Items
      const insertInvItem = db.prepare(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      let order = 0
      for (const it of items) {
        const itemAmount = (Number(it.setup_fee) || 0) * (Number(it.quantity) || 1)
        insertInvItem.run(invoiceId, it.description, it.quantity, it.setup_fee, itemAmount, order++)
      }

      // 3. Create Project
      const projRes = db.prepare(`
        INSERT INTO projects (
          title, client_id, quotation_id, invoice_id, assigned_to,
          status, budget, start_date, deliverables
        ) VALUES (?, ?, ?, ?, ?, 'development', ?, ?, ?)
      `).run(
        `${quote.package_type || 'Automation Project'} - ${invNumber}`,
        quote.client_id,
        quoteId,
        invoiceId,
        req.user.id,
        total,
        today,
        quote.deliverables || quote.scope_of_work
      )

      return { invoiceId, projectId: projRes.lastInsertRowid, invoiceNumber: invNumber }
    })

    const result = convertTx()

    logAudit({
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

// POST /api/quotations/:id/send-whatsapp - Direct WhatsApp Cloud API delivery with 24h window and confirmation check
router.post('/:id/send-whatsapp', requireAuth, requireRole('sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    const quote = db.prepare(`
      SELECT q.*, c.name as client_name, c.whatsapp_phone as client_phone
      FROM quotations q
      JOIN clients c ON q.client_id = c.id
      WHERE q.id = ?
    `).get(id)

    if (!quote) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quotation not found.' } })
    }

    if (!quote.client_phone) {
      return res.status(400).json({ success: false, error: { code: 'NO_PHONE', message: 'Client does not have a registered WhatsApp phone number.' } })
    }

    const cleanPhone = quote.client_phone.replace(/[^0-9]/g, '')
    const acceptUrl = `${process.env.API_URL || 'http://localhost:3001'}/api/quotations/accept/${quote.acceptance_token}`
    const messageText = `Hello ${quote.client_name},\n\nHere is your official proposal *${quote.quotation_number}* from *The Business Work* for: *${quote.package_type}*.\n\nReview and accept digitally:\n${acceptUrl}`

    const waMeUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`

    // Check 24h customer service window
    const conv = db.prepare('SELECT id, wa_window_expires FROM conversations WHERE phone_number = ?').get(cleanPhone)
    const now = new Date()
    const isWithinWindow = conv?.wa_window_expires && new Date(conv.wa_window_expires) > now

    // If outside 24h window and no template requested
    if (conv && !isWithinWindow && !req.body.template_name) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'OUTSIDE_24H_WINDOW',
          message: 'The Meta 24-hour customer service window has expired. Free-form text cannot be delivered directly. Send using an approved template or use the wa.me fallback.'
        },
        data: {
          wa_me_url: waMeUrl,
          window_expired_at: conv.wa_window_expires
        }
      })
    }

    // Call direct Meta WhatsApp service
    const metaRes = await sendMetaTextMessage({ to: cleanPhone, text: messageText })

    if (metaRes.skipped) {
      // Direct credentials not configured; do not mark 'sent' without confirmation
      return res.json({
        success: true,
        provider_confirmed: false,
        reason: 'CREDENTIALS_NOT_CONFIGURED',
        message: 'Meta WhatsApp credentials not configured on backend. Use the wa.me link as fallback.',
        data: {
          wa_me_url: waMeUrl
        }
      })
    }

    if (!metaRes.success) {
      return res.status(502).json({
        success: false,
        error: { code: 'PROVIDER_ERROR', message: metaRes.error },
        data: { wa_me_url: waMeUrl }
      })
    }

    // Meta confirmed acceptance: Update quotation status to 'sent'
    db.prepare("UPDATE quotations SET status = 'sent', sent_at = datetime('now'), sent_via = 'whatsapp_direct', updated_at = datetime('now') WHERE id = ?").run(id)

    // Record outbound message in conversation if exists
    if (conv) {
      db.prepare(`
        INSERT INTO messages (conversation_id, wa_message_id, direction, sender_type, sender_id, message_type, content, delivery_status)
        VALUES (?, ?, 'outbound', 'employee', ?, 'text', ?, 'sent')
      `).run(conv.id, metaRes.wa_message_id, req.user.id, messageText)
    }

    logAudit({
      userId: req.user.id,
      action: 'quotation.sent_whatsapp',
      entityType: 'quotation',
      entityId: id,
      details: { quotation_number: quote.quotation_number, wa_message_id: metaRes.wa_message_id },
      ipAddress: req.ip
    })

    res.json({
      success: true,
      provider_confirmed: true,
      data: {
        wa_message_id: metaRes.wa_message_id,
        wa_me_url: waMeUrl
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
