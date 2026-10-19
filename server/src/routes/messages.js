import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { sseManager } from '../services/sse.js'
import { generateToken } from '../utils/crypto.js'

const router = Router({ mergeParams: true })

const listMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
})

const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message text cannot be empty').max(4096),
  message_type: z.enum(['text', 'image', 'document', 'audio', 'video']).default('text'),
  media_url: z.string().url().optional()
})

// GET /api/conversations/:id/messages - Paginated message history
router.get('/', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), validate({ query: listMessagesSchema }), (req, res, next) => {
  try {
    const conversationId = parseInt(req.params.id, 10)
    const { limit, offset } = req.query
    const db = getDb()

    const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId)
    if (!conv) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    // Automatically mark unread count as 0 when viewed
    db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(conversationId)

    const totalCount = db.prepare('SELECT COUNT(*) as c FROM messages WHERE conversation_id = ?').get(conversationId).c

    const messages = db.prepare(`
      SELECT
        m.id,
        m.conversation_id,
        m.wa_message_id,
        m.direction,
        m.sender_type,
        m.sender_id,
        m.message_type,
        m.content,
        m.media_url,
        m.media_mime_type,
        m.caption,
        m.delivery_status,
        m.error_message,
        m.created_at,
        u.name as sender_name
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at ASC
      LIMIT ? OFFSET ?
    `).all(conversationId, limit, offset)

    res.json({
      success: true,
      data: {
        total: totalCount,
        limit,
        offset,
        items: messages
      }
    })
  } catch (err) {
    next(err)
  }
})

import { sendMetaTextMessage } from '../services/whatsapp.js'

// POST /api/conversations/:id/messages - Send outbound reply (Human mode)
router.post('/', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), validate({ body: sendMessageSchema }), async (req, res, next) => {
  try {
    const conversationId = parseInt(req.params.id, 10)
    const { content, message_type, media_url } = req.body
    const db = getDb()

    const conv = db.prepare(`
      SELECT id, phone_number, contact_name, mode, wa_window_expires
      FROM conversations
      WHERE id = ?
    `).get(conversationId)

    if (!conv) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    // Check 24-hour customer service window rule
    const now = new Date()
    if (conv.wa_window_expires) {
      const windowExpiry = new Date(conv.wa_window_expires)
      if (now > windowExpiry) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'WINDOW_EXPIRED',
            message: 'The 24-hour customer service window has expired. Standard free-form messages cannot be sent. You must send an approved template message to initiate re-engagement.'
          }
        })
      }
    }

    const localWaMsgId = `tbw_msg_${Date.now()}_${generateToken(8)}`

    // Initial state: PENDING (never claim 'sent' without provider confirmation)
    const insertResult = db.prepare(`
      INSERT INTO messages (
        conversation_id,
        wa_message_id,
        direction,
        sender_type,
        sender_id,
        message_type,
        content,
        media_url,
        delivery_status
      ) VALUES (?, ?, 'outbound', 'employee', ?, ?, ?, ?, 'pending')
    `).run(
      conversationId,
      localWaMsgId,
      req.user.id,
      message_type,
      content,
      media_url || null
    )

    const messageId = insertResult.lastInsertRowid

    // Update conversation last message preview
    const preview = content.length > 80 ? content.substring(0, 77) + '...' : content
    db.prepare(`
      UPDATE conversations
      SET last_message_at = datetime('now'),
          last_message_preview = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(preview, conversationId)

    let finalStatus = 'pending'
    let finalWaId = localWaMsgId
    let errorMessage = null

    // Attempt direct Meta Cloud API dispatch if configured
    if (message_type === 'text') {
      const metaResult = await sendMetaTextMessage({ to: conv.phone_number, text: content })
      if (metaResult.success && metaResult.wa_message_id) {
        finalStatus = 'sent'
        finalWaId = metaResult.wa_message_id
        db.prepare('UPDATE messages SET delivery_status = ?, wa_message_id = ? WHERE id = ?')
          .run(finalStatus, finalWaId, messageId)
      } else if (!metaResult.skipped && metaResult.error) {
        finalStatus = 'failed'
        errorMessage = metaResult.error
        db.prepare('UPDATE messages SET delivery_status = ?, error_message = ? WHERE id = ?')
          .run(finalStatus, errorMessage, messageId)
      }
    }

    const createdMessage = {
      id: messageId,
      conversation_id: conversationId,
      wa_message_id: finalWaId,
      direction: 'outbound',
      sender_type: 'employee',
      sender_id: req.user.id,
      sender_name: req.user.name,
      message_type,
      content,
      media_url: media_url || null,
      delivery_status: finalStatus,
      error_message: errorMessage,
      created_at: new Date().toISOString()
    }

    // Broadcast SSE event to live subscribers
    sseManager.broadcast('new_message', createdMessage)

    res.status(201).json({
      success: true,
      data: createdMessage
    })
  } catch (err) {
    next(err)
  }
})

export default router
