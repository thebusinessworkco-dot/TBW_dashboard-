import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'

const router = Router()

const listClientsSchema = z.object({
  status: z.enum(['new_lead', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'archived']).optional(),
  search: z.string().optional(),
  assigned_to: z.string().optional(),
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

// GET /api/clients - Search and list clients/leads
router.get('/', requireAuth, validate({ query: listClientsSchema }), async (req, res, next) => {
  try {
    const { status, search, assigned_to, limit, offset } = req.query

    const conditions = []
    const params = []
    let pIdx = 1

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

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

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
      WHERE c.next_followup IS NOT NULL
        AND c.lifecycle_status NOT IN ('won', 'lost', 'archived')
      ORDER BY c.next_followup ASC
      LIMIT 50
    `, [today])

    res.json({
      success: true,
      data: followUpsRes.rows
    })
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
      SELECT e.id, e.event_type, e.from_value, e.to_value, e.description, e.created_at, u.name as user_name
      FROM public.lead_events e
      LEFT JOIN public.users u ON e.user_id = u.id
      WHERE e.client_id = $1
      ORDER BY e.created_at DESC
    `, [id])

    const quotesRes = await query(`
      SELECT id, quotation_number, status, package_type, valid_until, created_at
      FROM public.quotations
      WHERE client_id = $1
      ORDER BY created_at DESC
    `, [id])

    res.json({
      success: true,
      data: {
        ...client,
        notes: notesRes.rows,
        events: eventsRes.rows,
        quotations: quotesRes.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/clients - Create client or lead
router.post('/', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: clientSchema }), async (req, res, next) => {
  try {
    const data = req.body
    const cleanPhone = data.whatsapp_phone ? data.whatsapp_phone.replace(/[^0-9]/g, '') : null

    if (cleanPhone) {
      const existingRes = await query('SELECT id FROM public.clients WHERE whatsapp_phone = $1', [cleanPhone])
      if (existingRes.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: { code: 'PHONE_EXISTS', message: 'A client with this WhatsApp phone number already exists.' }
        })
      }
    }

    const insertRes = await query(`
      INSERT INTO public.clients (
        name, whatsapp_phone, email, business_name, industry, city, country,
        language, service_category, requirement, budget, lead_source,
        assigned_to, tags, lifecycle_status, next_followup
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, created_at
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
      data.lead_source || 'Direct',
      data.assigned_to || req.user.id,
      data.tags || null,
      data.lifecycle_status || 'new_lead',
      data.next_followup || null
    ])

    const clientId = insertRes.rows[0].id

    // Record initial timeline event
    await query(`
      INSERT INTO public.lead_events (client_id, event_type, to_value, description, user_id)
      VALUES ($1, 'lead_created', $2, 'Lead created manually by team member', $3)
    `, [clientId, data.lifecycle_status, req.user.id])

    // Auto-link to existing WhatsApp conversation if phone matches
    if (cleanPhone) {
      await query('UPDATE public.conversations SET client_id = $1 WHERE phone_number = $2 AND client_id IS NULL', [clientId, cleanPhone])
    }

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

export default router
