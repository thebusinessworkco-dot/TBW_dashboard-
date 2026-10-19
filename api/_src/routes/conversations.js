import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'
import { sseManager } from '../services/sse.js'

const router = Router()

const listQuerySchema = z.object({
  status: z.enum(['open', 'resolved', 'archived']).optional(),
  mode: z.enum(['ai', 'human']).optional(),
  search: z.string().optional(),
  assigned: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
})

const updateModeSchema = z.object({
  mode: z.enum(['ai', 'human'])
})

const updateStatusSchema = z.object({
  status: z.enum(['open', 'resolved', 'archived'])
})

const assignSchema = z.object({
  assigned_to: z.number().int().nullable()
})

const noteSchema = z.object({
  content: z.string().min(1, 'Note content cannot be empty')
})

// GET /api/conversations - List conversations with filters
router.get('/', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const { status, mode, search, assigned, limit, offset } = req.query

    const conditions = []
    const params = []
    let pIdx = 1

    if (status) {
      conditions.push(`c.status = $${pIdx++}`)
      params.push(status)
    }

    if (mode) {
      conditions.push(`c.mode = $${pIdx++}`)
      params.push(mode)
    }

    if (search) {
      conditions.push(`(c.phone_number ILIKE $${pIdx} OR c.contact_name ILIKE $${pIdx} OR c.last_message_preview ILIKE $${pIdx})`)
      params.push(`%${search}%`)
      pIdx++
    }

    if (assigned === 'me') {
      conditions.push(`c.assigned_to = $${pIdx++}`)
      params.push(req.user.id)
    } else if (assigned === 'unassigned') {
      conditions.push('c.assigned_to IS NULL')
    } else if (assigned && !isNaN(parseInt(assigned, 10))) {
      conditions.push(`c.assigned_to = $${pIdx++}`)
      params.push(parseInt(assigned, 10))
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRes = await query(`
      SELECT COUNT(*)::int as c FROM public.conversations c ${whereClause}
    `, params)
    const totalCount = countRes.rows[0]?.c || 0

    const queryParams = [...params, limit, offset]
    const listRes = await query(`
      SELECT
        c.id,
        c.client_id,
        c.wa_conversation_id,
        c.phone_number,
        c.contact_name,
        c.mode,
        c.status,
        c.assigned_to,
        c.labels,
        c.unread_count,
        c.last_message_at,
        c.last_message_preview,
        c.wa_window_expires,
        c.created_at,
        c.updated_at,
        u.name as assigned_name,
        u.email as assigned_email,
        cl.business_name,
        cl.lifecycle_status as client_lifecycle
      FROM public.conversations c
      LEFT JOIN public.users u ON c.assigned_to = u.id
      LEFT JOIN public.clients cl ON c.client_id = cl.id
      ${whereClause}
      ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
      LIMIT $${pIdx++} OFFSET $${pIdx++}
    `, queryParams)

    const now = new Date()
    const items = listRes.rows.map(c => {
      let isWindowActive = false
      if (c.wa_window_expires) {
        isWindowActive = new Date(c.wa_window_expires) > now
      }
      return {
        ...c,
        is_window_active: isWindowActive
      }
    })

    res.json({
      success: true,
      data: {
        total: totalCount,
        limit,
        offset,
        items
      }
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/conversations/:id - Single conversation detail
router.get('/:id', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const convRes = await query(`
      SELECT
        c.*,
        u.name as assigned_name,
        u.email as assigned_email,
        cl.business_name,
        cl.industry,
        cl.email as client_email,
        cl.lifecycle_status,
        cl.requirement,
        cl.budget
      FROM public.conversations c
      LEFT JOIN public.users u ON c.assigned_to = u.id
      LEFT JOIN public.clients cl ON c.client_id = cl.id
      WHERE c.id = $1
    `, [id])

    const conversation = convRes.rows[0]
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    const notesRes = await query(`
      SELECT n.id, n.content, n.created_at, u.name as author_name
      FROM public.conversation_notes n
      LEFT JOIN public.users u ON n.user_id = u.id
      WHERE n.conversation_id = $1
      ORDER BY n.created_at DESC
    `, [id])

    const isWindowActive = conversation.wa_window_expires
      ? new Date(conversation.wa_window_expires) > new Date()
      : false

    res.json({
      success: true,
      data: {
        ...conversation,
        is_window_active: isWindowActive,
        notes: notesRes.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/conversations/:id/mode - Toggle AI / Human mode
router.patch('/:id/mode', requireAuth, requireRole('support', 'admin', 'owner'), validate({ body: updateModeSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { mode } = req.body

    const convRes = await query('SELECT id, phone_number, mode FROM public.conversations WHERE id = $1', [id])
    const conv = convRes.rows[0]

    if (!conv) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    await query(`
      UPDATE public.conversations
      SET mode = $1, updated_at = now()
      WHERE id = $2
    `, [mode, id])

    await logAudit({
      userId: req.user.id,
      action: 'conversation.mode_change',
      entityType: 'conversation',
      entityId: id,
      details: { previous: conv.mode, new: mode, phone: conv.phone_number },
      ipAddress: req.ip
    })

    const payload = { conversationId: id, phone: conv.phone_number, mode, updatedBy: req.user.name }
    sseManager.broadcast('mode_change', payload)

    res.json({
      success: true,
      data: {
        id,
        mode
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/conversations/:id/status - Update conversation status
router.patch('/:id/status', requireAuth, requireRole('support', 'admin', 'owner'), validate({ body: updateStatusSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status } = req.body

    const convRes = await query('SELECT id FROM public.conversations WHERE id = $1', [id])
    if (convRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    await query(`
      UPDATE public.conversations
      SET status = $1, updated_at = now()
      WHERE id = $2
    `, [status, id])

    sseManager.broadcast('conversation_update', { conversationId: id, status })

    res.json({
      success: true,
      data: { id, status }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/conversations/:id/assign - Assign to team member
router.patch('/:id/assign', requireAuth, requireRole('support', 'admin', 'owner'), validate({ body: assignSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { assigned_to } = req.body

    const convRes = await query('SELECT id FROM public.conversations WHERE id = $1', [id])
    if (convRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    if (assigned_to !== null) {
      const userRes = await query('SELECT id, name FROM public.users WHERE id = $1 AND is_active = true', [assigned_to])
      if (userRes.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Assigned user does not exist or is inactive.' }
        })
      }
    }

    await query(`
      UPDATE public.conversations
      SET assigned_to = $1, updated_at = now()
      WHERE id = $2
    `, [assigned_to, id])

    sseManager.broadcast('conversation_update', { conversationId: id, assigned_to })

    res.json({
      success: true,
      data: { id, assigned_to }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/conversations/:id/notes - Add note
router.post('/:id/notes', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), validate({ body: noteSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { content } = req.body

    const convRes = await query('SELECT id FROM public.conversations WHERE id = $1', [id])
    if (convRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    const insertRes = await query(`
      INSERT INTO public.conversation_notes (conversation_id, user_id, content)
      VALUES ($1, $2, $3)
      RETURNING id, created_at
    `, [id, req.user.id, content])

    res.status(201).json({
      success: true,
      data: {
        id: insertRes.rows[0].id,
        conversation_id: id,
        user_id: req.user.id,
        author_name: req.user.name,
        content,
        created_at: insertRes.rows[0].created_at
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
