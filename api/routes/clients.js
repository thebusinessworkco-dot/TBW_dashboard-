import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'
import { googleSheetsService } from '../services/googleSheets.js'

const router = Router()

const listClientsSchema = z.object({
  status: z.enum(['new_lead', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'archived']).optional(),
  search: z.string().optional(),
  assigned_to: z.string().optional(),
  trash: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
})

const clientSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  whatsapp_phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  business_name: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  country: z.string().default('India'),
  language: z.enum(['English', 'Hindi', 'Hinglish', 'Marathi']).default('English'),
  service_category: z.string().optional().nullable(),
  requirement: z.string().optional().nullable(),
  budget: z.coerce.number().optional().nullable(),
  lead_source: z.string().optional().nullable(),
  assigned_to: z.coerce.number().int().optional().nullable(),
  tags: z.string().optional().nullable(),
  lifecycle_status: z.enum(['new_lead', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'archived']).default('new_lead'),
  next_followup: z.string().optional().nullable()
})

const updateStatusSchema = z.object({
  status: z.enum(['new_lead', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'archived']),
  note: z.string().optional()
})

const noteSchema = z.object({
  content: z.string().min(1, 'Note content cannot be empty')
})

const sheetsConfigSchema = z.object({
  spreadsheet_id: z.string().min(5, 'Spreadsheet ID is required'),
  sheet_name: z.string().default('Leads'),
  header_row: z.coerce.number().int().min(1).default(1),
  auto_sync_enabled: z.boolean().default(true),
  sync_interval_minutes: z.coerce.number().int().min(1).max(1440).default(15)
})

// ============================================================================
// STATIC SUBPATHS (Must precede /:id)
// ============================================================================

// GET /api/clients/sync-status - Check Google Sheets two-way sync health & logs
router.get('/sync-status', requireAuth, async (req, res, next) => {
  try {
    const status = await googleSheetsService.getStatus()
    res.json({ success: true, data: status })
  } catch (err) {
    next(err)
  }
})

// POST /api/clients/sync-sheets - Trigger immediate two-way sync
router.post('/sync-sheets', requireAuth, requireRole('sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const result = await googleSheetsService.syncTwoWay(req.user.id)
    if (!result.success && result.error === 'CONFIG_REQUIRED') {
      return res.status(200).json({
        success: false,
        code: 'CONFIG_REQUIRED',
        message: result.message
      })
    }
    if (!result.success) {
      return res.status(400).json({ success: false, error: result })
    }

    await logAudit({
      userId: req.user.id,
      action: 'crm.google_sheets_synced',
      entityType: 'google_sheets',
      entityId: 0,
      details: result,
      ipAddress: req.ip
    })

    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

// GET /api/clients/sheets-config - Get current Google Sheets integration settings
router.get('/sheets-config', requireAuth, async (req, res, next) => {
  try {
    const config = await googleSheetsService.getConfig()
    res.json({ success: true, data: config })
  } catch (err) {
    next(err)
  }
})

// PUT /api/clients/sheets-config - Update Google Sheets integration settings
router.put('/sheets-config', requireAuth, requireRole('admin', 'owner'), validate({ body: sheetsConfigSchema }), async (req, res, next) => {
  try {
    const { spreadsheet_id, sheet_name, header_row, auto_sync_enabled, sync_interval_minutes } = req.body

    const updateRes = await query(`
      INSERT INTO public.google_sheet_config (spreadsheet_id, sheet_name, header_row, auto_sync_enabled, sync_interval_minutes, updated_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (id) DO UPDATE SET
        spreadsheet_id = EXCLUDED.spreadsheet_id,
        sheet_name = EXCLUDED.sheet_name,
        header_row = EXCLUDED.header_row,
        auto_sync_enabled = EXCLUDED.auto_sync_enabled,
        sync_interval_minutes = EXCLUDED.sync_interval_minutes,
        updated_at = now()
      RETURNING *
    `, [spreadsheet_id, sheet_name, header_row, auto_sync_enabled, sync_interval_minutes])

    res.json({ success: true, data: updateRes.rows[0] })
  } catch (err) {
    next(err)
  }
})

// GET /api/clients/export-csv - Export active CRM leads as authenticated CSV
router.get('/export-csv', requireAuth, async (req, res, next) => {
  try {
    const leadsRes = await query(`
      SELECT
        c.id, c._tbw_id, c.name, c.whatsapp_phone, c.email, c.business_name,
        c.industry, c.city, c.country, c.language, c.service_category,
        c.requirement, c.budget, c.lead_source, c.lifecycle_status,
        c.next_followup, c.created_at, u.name as assigned_name
      FROM public.clients c
      LEFT JOIN public.users u ON c.assigned_to = u.id
      WHERE c.is_deleted = false
      ORDER BY c.created_at DESC
    `)

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""'
      const str = String(val).replace(/"/g, '""')
      return `"${str}"`
    }

    const headers = [
      'ID', 'TBW_ID', 'Name', 'Phone', 'Email', 'Company', 'Industry',
      'City', 'Country', 'Language', 'Service Category', 'Requirement',
      'Budget (INR)', 'Lead Source', 'Status', 'Next Followup', 'Assigned To', 'Created At'
    ]

    const csvRows = [headers.join(',')]

    for (const lead of leadsRes.rows) {
      csvRows.push([
        lead.id,
        escapeCsv(lead._tbw_id),
        escapeCsv(lead.name),
        escapeCsv(lead.whatsapp_phone),
        escapeCsv(lead.email),
        escapeCsv(lead.business_name),
        escapeCsv(lead.industry),
        escapeCsv(lead.city),
        escapeCsv(lead.country),
        escapeCsv(lead.language),
        escapeCsv(lead.service_category),
        escapeCsv(lead.requirement),
        lead.budget || '',
        escapeCsv(lead.lead_source),
        escapeCsv(lead.lifecycle_status),
        escapeCsv(lead.next_followup),
        escapeCsv(lead.assigned_name),
        escapeCsv(lead.created_at)
      ].join(','))
    }

    const csvContent = csvRows.join('\r\n')
    const filename = `tbw_leads_${new Date().toISOString().split('T')[0]}.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(csvContent)
  } catch (err) {
    next(err)
  }
})

// GET /api/clients/follow-ups - List pending and overdue follow-up reminders
router.get('/follow-ups', requireAuth, async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0]

    const followUpsRes = await query(`
      SELECT
        c.id, c.name, c.business_name, c.whatsapp_phone, c.lifecycle_status,
        c.next_followup, c.requirement, u.name as assigned_name,
        CASE
          WHEN c.next_followup::date < $1::date THEN 'overdue'
          WHEN c.next_followup::date = $1::date THEN 'today'
          ELSE 'upcoming'
        END as reminder_urgency
      FROM public.clients c
      LEFT JOIN public.users u ON c.assigned_to = u.id
      WHERE c.is_deleted = false
        AND c.next_followup IS NOT NULL
        AND c.lifecycle_status NOT IN ('won', 'lost', 'archived')
      ORDER BY c.next_followup ASC
      LIMIT 50
    `, [today])

    res.json({ success: true, data: followUpsRes.rows })
  } catch (err) {
    next(err)
  }
})

// GET /api/clients/trash - List recoverable soft-deleted leads
router.get('/trash', requireAuth, requireRole('sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const trashRes = await query(`
      SELECT
        c.*,
        u.name as deleted_by_name
      FROM public.clients c
      LEFT JOIN public.users u ON c.deleted_by = u.id
      WHERE c.is_deleted = true
      ORDER BY c.deleted_at DESC
      LIMIT 100
    `)

    res.json({ success: true, data: trashRes.rows })
  } catch (err) {
    next(err)
  }
})

// ============================================================================
// MAIN CLIENT COLLECTION & CRUD
// ============================================================================

// GET /api/clients - Search and list clients/leads
router.get('/', requireAuth, validate({ query: listClientsSchema }), async (req, res, next) => {
  try {
    const { status, search, assigned_to, trash, limit, offset } = req.query

    const conditions = []
    const params = []
    let pIdx = 1

    if (trash) {
      conditions.push('c.is_deleted = true')
    } else {
      conditions.push('c.is_deleted = false')
    }

    if (status) {
      conditions.push(`c.lifecycle_status = $${pIdx++}`)
      params.push(status)
    }

    if (search) {
      conditions.push(`(c.name ILIKE $${pIdx} OR c.business_name ILIKE $${pIdx} OR c.whatsapp_phone ILIKE $${pIdx} OR c.email ILIKE $${pIdx})`)
      params.push(`%${search}%`)
      pIdx++
    }

    if (assigned_to === 'me') {
      conditions.push(`c.assigned_to = $${pIdx++}`)
      params.push(req.user.id)
    } else if (assigned_to && !isNaN(parseInt(assigned_to, 10))) {
      conditions.push(`c.assigned_to = $${pIdx++}`)
      params.push(parseInt(assigned_to, 10))
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`

    const countRes = await query(`SELECT COUNT(*)::int as c FROM public.clients c ${whereClause}`, params)
    const totalCount = countRes.rows[0]?.c || 0

    const queryParams = [...params, limit, offset]
    const listRes = await query(`
      SELECT
        c.*,
        u.name as assigned_name,
        (SELECT COUNT(*)::int FROM public.quotations q WHERE q.client_id = c.id) as quote_count,
        (SELECT COUNT(*)::int FROM public.invoices inv WHERE inv.client_id = c.id) as invoice_count,
        (SELECT id FROM public.conversations conv WHERE conv.client_id = c.id OR conv.phone_number = c.whatsapp_phone LIMIT 1) as conversation_id
      FROM public.clients c
      LEFT JOIN public.users u ON c.assigned_to = u.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${pIdx++} OFFSET $${pIdx++}
    `, queryParams)

    res.json({
      success: true,
      data: {
        total: totalCount,
        limit,
        offset,
        items: listRes.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/clients/:id/restore - Restore soft-deleted lead
router.post('/:id/restore', requireAuth, requireRole('sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const checkRes = await query('SELECT id, name FROM public.clients WHERE id = $1', [id])
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } })
    }

    await query(`
      UPDATE public.clients
      SET is_deleted = false, deleted_at = NULL, deleted_by = NULL, updated_at = now()
      WHERE id = $1
    `, [id])

    await query(`
      INSERT INTO public.lead_events (client_id, event_type, description, user_id)
      VALUES ($1, 'lead_restored', 'Lead restored from trash', $2)
    `, [id, req.user.id])

    await logAudit({
      userId: req.user.id,
      action: 'client.restored',
      entityType: 'client',
      entityId: id,
      details: { name: checkRes.rows[0].name },
      ipAddress: req.ip
    })

    res.json({ success: true, message: 'Client restored successfully.' })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/clients/:id/permanent - Permanent hard delete (admin/owner only)
router.delete('/:id/permanent', requireAuth, requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const checkRes = await query('SELECT id, name FROM public.clients WHERE id = $1', [id])
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } })
    }

    // Check financial relationships to avoid orphan invoices
    const quoteCountRes = await query('SELECT COUNT(*)::int as c FROM public.quotations WHERE client_id = $1', [id])
    const invCountRes = await query('SELECT COUNT(*)::int as c FROM public.invoices WHERE client_id = $1', [id])

    if (quoteCountRes.rows[0].c > 0 || invCountRes.rows[0].c > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'HAS_FINANCIAL_RECORDS',
          message: 'Cannot permanently delete a client with existing invoices or quotations. Keep the record soft-deleted to maintain audit compliance.'
        }
      })
    }

    await query('DELETE FROM public.clients WHERE id = $1', [id])

    await logAudit({
      userId: req.user.id,
      action: 'client.permanently_deleted',
      entityType: 'client',
      entityId: id,
      details: { name: checkRes.rows[0].name },
      ipAddress: req.ip
    })

    res.json({ success: true, message: 'Client permanently removed from database.' })
  } catch (err) {
    next(err)
  }
})

// GET /api/clients/:id - Client detail with timeline
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const clientRes = await query(`
      SELECT c.*, u.name as assigned_name, u.email as assigned_email
      FROM public.clients c
      LEFT JOIN public.users u ON c.assigned_to = u.id
      WHERE c.id = $1
    `, [id])

    const client = clientRes.rows[0]
    if (!client) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } })
    }

    const notesRes = await query(`
      SELECT n.id, n.content, n.created_at, u.name as author_name
      FROM public.client_notes n
      LEFT JOIN public.users u ON n.user_id = u.id
      WHERE n.client_id = $1
      ORDER BY n.created_at DESC
    `, [id])

    const eventsRes = await query(`
      SELECT le.*, u.name as author_name
      FROM public.lead_events le
      LEFT JOIN public.users u ON le.user_id = u.id
      WHERE le.client_id = $1
      ORDER BY le.created_at DESC
      LIMIT 50
    `, [id])

    const quotationsRes = await query(`
      SELECT id, quotation_number, status, total_amount, currency, created_at, valid_until
      FROM public.quotations
      WHERE client_id = $1
      ORDER BY created_at DESC
    `, [id])

    const invoicesRes = await query(`
      SELECT id, invoice_number, status, total_amount, balance_due, currency, created_at, due_date
      FROM public.invoices
      WHERE client_id = $1
      ORDER BY created_at DESC
    `, [id])

    res.json({
      success: true,
      data: {
        ...client,
        notes: notesRes.rows,
        events: eventsRes.rows,
        quotations: quotationsRes.rows,
        invoices: invoicesRes.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/clients - Create new client / lead
router.post('/', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: clientSchema }), async (req, res, next) => {
  try {
    const data = req.body
    const cleanPhone = data.whatsapp_phone ? data.whatsapp_phone.replace(/[^0-9]/g, '') : null

    if (cleanPhone) {
      const existing = await query('SELECT id, name FROM public.clients WHERE whatsapp_phone = $1 AND is_deleted = false', [cleanPhone])
      if (existing.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'PHONE_EXISTS',
            message: `A client with phone ${cleanPhone} already exists: "${existing.rows[0].name}"`,
            clientId: existing.rows[0].id
          }
        })
      }
    }

    const insertRes = await query(`
      INSERT INTO public.clients (
        name, whatsapp_phone, email, business_name, industry, city, country,
        language, service_category, requirement, budget, lead_source, assigned_to,
        tags, lifecycle_status, next_followup
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, _tbw_id
    `, [
      data.name,
      cleanPhone,
      data.email || null,
      data.business_name || null,
      data.industry || null,
      data.city || null,
      data.country || 'India',
      data.language || 'English',
      data.service_category || null,
      data.requirement || null,
      data.budget || null,
      data.lead_source || null,
      data.assigned_to || null,
      data.tags || null,
      data.lifecycle_status,
      data.next_followup || null
    ])

    const clientId = insertRes.rows[0].id

    await query(`
      INSERT INTO public.lead_events (client_id, event_type, to_value, description, user_id)
      VALUES ($1, 'lead_created', $2, 'Client profile created', $3)
    `, [clientId, data.lifecycle_status, req.user.id])

    await logAudit({
      userId: req.user.id,
      action: 'client.created',
      entityType: 'client',
      entityId: clientId,
      details: { name: data.name, phone: cleanPhone, status: data.lifecycle_status },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: clientId,
        _tbw_id: insertRes.rows[0]._tbw_id,
        ...data,
        whatsapp_phone: cleanPhone
      }
    })
  } catch (err) {
    next(err)
  }
})

// PUT /api/clients/:id - Update client
router.put('/:id', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: clientSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const data = req.body

    const currentRes = await query('SELECT id, lifecycle_status, whatsapp_phone FROM public.clients WHERE id = $1', [id])
    const current = currentRes.rows[0]
    if (!current) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } })
    }

    const cleanPhone = data.whatsapp_phone ? data.whatsapp_phone.replace(/[^0-9]/g, '') : null

    await query(`
      UPDATE public.clients SET
        name = $1, whatsapp_phone = $2, email = $3, business_name = $4, industry = $5,
        city = $6, country = $7, language = $8, service_category = $9, requirement = $10,
        budget = $11, lead_source = $12, assigned_to = $13, tags = $14, lifecycle_status = $15,
        next_followup = $16, updated_at = now()
      WHERE id = $17
    `, [
      data.name,
      cleanPhone,
      data.email || null,
      data.business_name || null,
      data.industry || null,
      data.city || null,
      data.country || 'India',
      data.language || 'English',
      data.service_category || null,
      data.requirement || null,
      data.budget || null,
      data.lead_source || null,
      data.assigned_to || null,
      data.tags || null,
      data.lifecycle_status,
      data.next_followup || null,
      id
    ])

    if (current.lifecycle_status !== data.lifecycle_status) {
      await query(`
        INSERT INTO public.lead_events (client_id, event_type, from_value, to_value, description, user_id)
        VALUES ($1, 'status_change', $2, $3, 'Pipeline status updated', $4)
      `, [id, current.lifecycle_status, data.lifecycle_status, req.user.id])
    }

    res.json({ success: true, message: 'Client updated successfully.' })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/clients/:id/status - Change pipeline stage
router.patch('/:id/status', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: updateStatusSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status, note } = req.body

    const currentRes = await query('SELECT lifecycle_status FROM public.clients WHERE id = $1', [id])
    const current = currentRes.rows[0]
    if (!current) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } })
    }

    await query('UPDATE public.clients SET lifecycle_status = $1, updated_at = now() WHERE id = $2', [status, id])

    await query(`
      INSERT INTO public.lead_events (client_id, event_type, from_value, to_value, description, user_id)
      VALUES ($1, 'status_change', $2, $3, $4, $5)
    `, [id, current.lifecycle_status, status, note || 'Pipeline stage changed', req.user.id])

    res.json({ success: true, data: { id, status } })
  } catch (err) {
    next(err)
  }
})

// POST /api/clients/:id/notes - Add client note
router.post('/:id/notes', requireAuth, validate({ body: noteSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { content } = req.body

    const clientRes = await query('SELECT id FROM public.clients WHERE id = $1', [id])
    if (clientRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } })
    }

    const insertRes = await query(`
      INSERT INTO public.client_notes (client_id, user_id, content) VALUES ($1, $2, $3)
      RETURNING id, created_at
    `, [id, req.user.id, content])

    res.status(201).json({
      success: true,
      data: {
        id: insertRes.rows[0].id,
        client_id: id,
        content,
        author_name: req.user.name,
        created_at: insertRes.rows[0].created_at
      }
    })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/clients/:id - Soft delete lead (safe deletion with tombstone)
router.delete('/:id', requireAuth, requireRole('sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const checkRes = await query('SELECT id, name FROM public.clients WHERE id = $1', [id])
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } })
    }

    await query(`
      UPDATE public.clients
      SET is_deleted = true, deleted_at = now(), deleted_by = $1, updated_at = now()
      WHERE id = $2
    `, [req.user.id, id])

    await query(`
      INSERT INTO public.lead_events (client_id, event_type, description, user_id)
      VALUES ($1, 'lead_deleted', 'Lead moved to trash (soft deletion)', $2)
    `, [id, req.user.id])

    await logAudit({
      userId: req.user.id,
      action: 'client.soft_deleted',
      entityType: 'client',
      entityId: id,
      details: { name: checkRes.rows[0].name },
      ipAddress: req.ip
    })

    res.json({ success: true, message: 'Client moved to trash. Can be restored anytime.' })
  } catch (err) {
    next(err)
  }
})

export default router
