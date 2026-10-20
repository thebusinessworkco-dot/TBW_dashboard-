import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { sseManager } from '../services/sse.js'
import { generateToken } from '../utils/crypto.js'
import { sendMetaTextMessage } from '../services/whatsapp.js'

const router = Router({ mergeParams: true })

const listMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  since: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional()
})

const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message text cannot be empty').max(4096),
  message_type: z.enum(['text', 'image', 'document', 'audio', 'video']).default('text'),
  media_url: z.string().url().optional()
})

// GET /api/conversations/:id/messages - Paginated or incremental message history
router.get('/', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), validate({ query: listMessagesSchema }), async (req, res, next) => {
  try {
    const conversationId = parseInt(req.params.id, 10)
    const { limit, offset, since, order } = req.query

    const convRes = await query('SELECT id FROM public.conversations WHERE id = $1', [conversationId])
    if (convRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found.' }
      })
    }

    // Automatically mark unread count as 0 when viewed
    await query('UPDATE public.conversations SET unread_count = 0 WHERE id = $1', [conversationId])

    const conditions = ['m.conversation_id = $1']
    const params = [conversationId]
    let pIdx = 2

    if (since) {
      conditions.push(`m.created_at > $${pIdx++}`)
      params.push(since)
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`

    const countRes = await query(`SELECT COUNT(*)::int as c FROM public.messages m ${whereClause}`, params)
    const totalCount = countRes.rows[0]?.c || 0

    const queryParams = [...params, limit, offset]
    const limitPlaceholder = `$${pIdx++}`
    const offsetPlaceholder = `$${pIdx++}`

    let sql = ''
    if (order === 'desc') {
      sql = `
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
          m.metadata,
          m.created_at,
          u.name as sender_name
        FROM public.messages m
        LEFT JOIN public.users u ON m.sender_id = u.id
        ${whereClause}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `
    } else if (since) {
      sql = `
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
          m.metadata,
          m.created_at,
          u.name as sender_name
        FROM public.messages m
        LEFT JOIN public.users u ON m.sender_id = u.id
        ${whereClause}
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `
    } else {
      // Chat default: Fetch the most recent messages up to limit, ordered chronologically (ASC)
      sql = `
        SELECT * FROM (
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
            m.metadata,
            m.created_at,
            u.name as sender_name
          FROM public.messages m
          LEFT JOIN public.users u ON m.sender_id = u.id
          ${whereClause}
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
        ) sub
        ORDER BY sub.created_at ASC, sub.id ASC
      `
    }

    const messagesRes = await query(sql, queryParams)

    res.json({
      success: true,
      data: {
        total: totalCount,
        limit,
        offset,
        items: messagesRes.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/conversations/:id/messages - Send outbound reply (Human mode)
router.post('/', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), validate({ body: sendMessageSchema }), async (req, res, next) => {
  try {
    const conversationId = parseInt(req.params.id, 10)
    const { content, message_type, media_url } = req.body

    const convRes = await query(`
      SELECT id, phone_number, contact_name, mode, wa_window_expires
      FROM public.conversations
      WHERE id = $1
    `, [conversationId])

    const conv = convRes.rows[0]
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
    const insertRes = await query(`
      INSERT INTO public.messages (
        conversation_id,
        wa_message_id,
        direction,
        sender_type,
        sender_id,
        message_type,
        content,
        media_url,
        delivery_status
      ) VALUES ($1, $2, 'outbound', 'employee', $3, $4, $5, $6, 'pending')
      RETURNING id, created_at
    `, [
      conversationId,
      localWaMsgId,
      req.user.id,
      message_type,
      content,
      media_url || null
    ])

    const messageId = insertRes.rows[0].id
    const createdAt = insertRes.rows[0].created_at

    // Update conversation last message preview
    const preview = content.length > 80 ? content.substring(0, 77) + '...' : content
    await query(`
      UPDATE public.conversations
      SET last_message_at = now(),
          last_message_preview = $1,
          updated_at = now()
      WHERE id = $2
    `, [preview, conversationId])

    let finalStatus = 'pending'
    let finalWaId = localWaMsgId
    let errorMessage = null

    // Attempt direct Meta Cloud API dispatch if configured
    if (message_type === 'text') {
      const metaResult = await sendMetaTextMessage({ to: conv.phone_number, text: content })
      if (metaResult.success && metaResult.wa_message_id) {
        finalStatus = 'sent'
        finalWaId = metaResult.wa_message_id
        await query('UPDATE public.messages SET delivery_status = $1, wa_message_id = $2 WHERE id = $3', [finalStatus, finalWaId, messageId])
      } else if (metaResult.skipped) {
        finalStatus = 'failed'
        errorMessage = 'WhatsApp credentials (WA_ACCESS_TOKEN or WA_PHONE_NUMBER_ID) not configured on server'
        await query('UPDATE public.messages SET delivery_status = $1, error_message = $2 WHERE id = $3', [finalStatus, errorMessage, messageId])
      } else if (metaResult.error) {
        finalStatus = 'failed'
        errorMessage = metaResult.error
        await query('UPDATE public.messages SET delivery_status = $1, error_message = $2 WHERE id = $3', [finalStatus, errorMessage, messageId])
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
      created_at: createdAt
    }

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
