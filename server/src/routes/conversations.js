import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
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
router.get('/', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), validate({ query: listQuerySchema }), (req, res, next) => {
  try {
    const { status, mode, search, assigned, limit, offset } = req.query
    const db = getDb()

    const conditions = []
    const params = []

    if (status) {
      conditions.push('c.status = ?')
      params.push(status)
    }

    if (mode) {
      conditions.push('c.mode = ?')
      params.push(mode)
    }

    if (search) {
      conditions.push('(c.phone_number LIKE ? OR c.contact_name LIKE ? OR c.last_message_preview LIKE ?)')
      const pattern = `%${search}%`
      params.push(pattern, pattern, pattern)
    }

    if (assigned === 'me') {
      conditions.push('c.assigned_to = ?')
      params.push(req.user.id)
    } else if (assigned === 'unassigned') {
      conditions.push('c.assigned_to IS NULL')
    } else if (assigned && !isNaN(parseInt(assigned, 10))) {
      conditions.push('c.assigned_to = ?')
      params.push(parseInt(assigned, 10))
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const totalCount = db.prepare(`
      SELECT COUNT(*) as c FROM conversations c ${whereClause}
    `).get(...params).c

    const conversations = db.prepare(`
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
      FROM conversations c
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      ${whereClause}
      ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)

    const now = new Date()
    const items = conversations.map(c => {
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
router.get('/:id', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    const conversation = db.prepare(`
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
      FROM conversations c
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE c.id = ?
    `).get(id)

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    const notes = db.prepare(`
      SELECT n.id, n.content, n.created_at, u.name as author_name
      FROM conversation_notes n
      LEFT JOIN users u ON n.user_id = u.id
      WHERE n.conversation_id = ?
      ORDER BY n.created_at DESC
    `).all(id)

    const isWindowActive = conversation.wa_window_expires
      ? new Date(conversation.wa_window_expires) > new Date()
      : false

    res.json({
      success: true,
      data: {
        ...conversation,
        is_window_active: isWindowActive,
        notes
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/conversations/:id/mode - Toggle AI / Human mode
router.patch('/:id/mode', requireAuth, requireRole('support', 'admin', 'owner'), validate({ body: updateModeSchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { mode } = req.body
    const db = getDb()

    const conv = db.prepare('SELECT id, phone_number, mode FROM conversations WHERE id = ?').get(id)
    if (!conv) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    db.prepare(`
      UPDATE conversations
      SET mode = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(mode, id)

    logAudit({
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
router.patch('/:id/status', requireAuth, requireRole('support', 'admin', 'owner'), validate({ body: updateStatusSchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status } = req.body
    const db = getDb()

    const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id)
    if (!conv) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    db.prepare(`
      UPDATE conversations
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, id)

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
router.patch('/:id/assign', requireAuth, requireRole('support', 'admin', 'owner'), validate({ body: assignSchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { assigned_to } = req.body
    const db = getDb()

    const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id)
    if (!conv) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    if (assigned_to !== null) {
      const user = db.prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1').get(assigned_to)
      if (!user) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Assigned user does not exist or is inactive.' }
        })
      }
    }

    db.prepare(`
      UPDATE conversations
      SET assigned_to = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(assigned_to, id)

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
router.post('/:id/notes', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), validate({ body: noteSchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { content } = req.body
    const db = getDb()

    const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id)
    if (!conv) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    const result = db.prepare(`
      INSERT INTO conversation_notes (conversation_id, user_id, content)
      VALUES (?, ?, ?)
    `).run(id, req.user.id, content)

    res.status(201).json({
      success: true,
      data: {
        id: result.lastInsertRowid,
        conversation_id: id,
        user_id: req.user.id,
        author_name: req.user.name,
        content,
        created_at: new Date().toISOString()
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
