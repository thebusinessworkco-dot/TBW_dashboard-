import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
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
router.get('/', requireAuth, validate({ query: listClientsSchema }), (req, res, next) => {
  try {
    const { status, search, assigned_to, limit, offset } = req.query
    const db = getDb()

    const conditions = []
    const params = []

    if (status) {
      conditions.push('c.lifecycle_status = ?')
      params.push(status)
    }

    if (search) {
      conditions.push('(c.name LIKE ? OR c.business_name LIKE ? OR c.whatsapp_phone LIKE ? OR c.email LIKE ?)')
      const pattern = `%${search}%`
      params.push(pattern, pattern, pattern, pattern)
    }

    if (assigned_to === 'me') {
      conditions.push('c.assigned_to = ?')
      params.push(req.user.id)
    } else if (assigned_to && !isNaN(parseInt(assigned_to, 10))) {
      conditions.push('c.assigned_to = ?')
      params.push(parseInt(assigned_to, 10))
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const totalCount = db.prepare(`SELECT COUNT(*) as c FROM clients c ${whereClause}`).get(...params).c

    const clients = db.prepare(`
      SELECT
        c.*,
        u.name as assigned_name,
        (SELECT COUNT(*) FROM quotations q WHERE q.client_id = c.id) as quote_count,
        (SELECT COUNT(*) FROM invoices inv WHERE inv.client_id = c.id) as invoice_count,
        (SELECT id FROM conversations conv WHERE conv.client_id = c.id OR conv.phone_number = c.whatsapp_phone LIMIT 1) as conversation_id
      FROM clients c
      LEFT JOIN users u ON c.assigned_to = u.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)

    res.json({
      success: true,
      data: {
        total: totalCount,
        limit,
        offset,
        items: clients
      }
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/clients/follow-ups - List pending and overdue follow-up reminders
router.get('/follow-ups', requireAuth, (req, res, next) => {
  try {
    const db = getDb()
    const today = new Date().toISOString().split('T')[0]

    const followUps = db.prepare(`
      SELECT
        c.id, c.name, c.business_name, c.whatsapp_phone, c.lifecycle_status,
        c.next_followup, c.requirement, u.name as assigned_name,
        CASE
          WHEN c.next_followup < ? THEN 'overdue'
          WHEN c.next_followup = ? THEN 'today'
          ELSE 'upcoming'
        END as reminder_urgency
      FROM clients c
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.next_followup IS NOT NULL
        AND c.lifecycle_status NOT IN ('won', 'lost', 'archived')
      ORDER BY c.next_followup ASC
      LIMIT 50
    `).all(today, today)

    res.json({
      success: true,
      data: followUps
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/clients/:id - Client detail with timeline
router.get('/:id', requireAuth, (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    const client = db.prepare(`
      SELECT c.*, u.name as assigned_name, u.email as assigned_email
      FROM clients c
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.id = ?
    `).get(id)

    if (!client) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } })
    }

    const notes = db.prepare(`
      SELECT n.id, n.content, n.created_at, u.name as author_name
      FROM client_notes n
      LEFT JOIN users u ON n.user_id = u.id
      WHERE n.client_id = ?
      ORDER BY n.created_at DESC
    `).all(id)

    const events = db.prepare(`
      SELECT e.id, e.event_type, e.from_value, e.to_value, e.description, e.created_at, u.name as user_name
      FROM lead_events e
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.client_id = ?
      ORDER BY e.created_at DESC
    `).all(id)

    const quotations = db.prepare(`
      SELECT id, quotation_number, status, package_type, valid_until, created_at
      FROM quotations
      WHERE client_id = ?
      ORDER BY created_at DESC
    `).all(id)

    res.json({
      success: true,
      data: {
        ...client,
        notes,
        events,
        quotations
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/clients - Create client or lead
router.post('/', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: clientSchema }), (req, res, next) => {
  try {
    const db = getDb()
    const data = req.body

    const cleanPhone = data.whatsapp_phone ? data.whatsapp_phone.replace(/[^0-9]/g, '') : null

    if (cleanPhone) {
      const existing = db.prepare('SELECT id FROM clients WHERE whatsapp_phone = ?').get(cleanPhone)
      if (existing) {
        return res.status(409).json({
          success: false,
          error: { code: 'PHONE_EXISTS', message: 'A client with this WhatsApp phone number already exists.' }
        })
      }
    }

    const result = db.prepare(`
      INSERT INTO clients (
        name, whatsapp_phone, email, business_name, industry, city, country,
        language, service_category, requirement, budget, lead_source,
        assigned_to, tags, lifecycle_status, next_followup
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
    )

    const clientId = result.lastInsertRowid

    // Record initial timeline event
    db.prepare(`
      INSERT INTO lead_events (client_id, event_type, to_value, description, user_id)
      VALUES (?, 'lead_created', ?, 'Lead created manually by team member', ?)
    `).run(clientId, data.lifecycle_status, req.user.id)

    // Auto-link to existing WhatsApp conversation if phone matches
    if (cleanPhone) {
      db.prepare('UPDATE conversations SET client_id = ? WHERE phone_number = ? AND client_id IS NULL')
        .run(clientId, cleanPhone)
    }

    logAudit({
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
router.put('/:id', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: clientSchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()
    const data = req.body

    const current = db.prepare('SELECT id, lifecycle_status, whatsapp_phone FROM clients WHERE id = ?').get(id)
    if (!current) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } })
    }

    const cleanPhone = data.whatsapp_phone ? data.whatsapp_phone.replace(/[^0-9]/g, '') : null

    db.prepare(`
      UPDATE clients SET
        name = ?, whatsapp_phone = ?, email = ?, business_name = ?, industry = ?,
        city = ?, country = ?, language = ?, service_category = ?, requirement = ?,
        budget = ?, lead_source = ?, assigned_to = ?, tags = ?, lifecycle_status = ?,
        next_followup = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
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
    )

    if (current.lifecycle_status !== data.lifecycle_status) {
      db.prepare(`
        INSERT INTO lead_events (client_id, event_type, from_value, to_value, description, user_id)
        VALUES (?, 'status_change', ?, ?, 'Pipeline status updated', ?)
      `).run(id, current.lifecycle_status, data.lifecycle_status, req.user.id)
    }

    res.json({ success: true, message: 'Client updated successfully.' })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/clients/:id/status - Change pipeline stage
router.patch('/:id/status', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: updateStatusSchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status, note } = req.body
    const db = getDb()

    const current = db.prepare('SELECT lifecycle_status FROM clients WHERE id = ?').get(id)
    if (!current) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } })
    }

    db.prepare(`
      UPDATE clients SET lifecycle_status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, id)

    db.prepare(`
      INSERT INTO lead_events (client_id, event_type, from_value, to_value, description, user_id)
      VALUES (?, 'status_change', ?, ?, ?, ?)
    `).run(id, current.lifecycle_status, status, note || 'Pipeline stage changed', req.user.id)

    res.json({ success: true, data: { id, status } })
  } catch (err) {
    next(err)
  }
})

// POST /api/clients/:id/notes - Add client note
router.post('/:id/notes', requireAuth, validate({ body: noteSchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { content } = req.body
    const db = getDb()

    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(id)
    if (!client) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } })
    }

    const result = db.prepare(`
      INSERT INTO client_notes (client_id, user_id, content) VALUES (?, ?, ?)
    `).run(id, req.user.id, content)

    res.status(201).json({
      success: true,
      data: {
        id: result.lastInsertRowid,
        client_id: id,
        content,
        author_name: req.user.name,
        created_at: new Date().toISOString()
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
