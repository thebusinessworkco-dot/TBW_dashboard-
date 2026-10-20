import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { sseManager } from '../services/sse.js'
import { logger } from '../utils/logger.js'

const router = Router()

function requireN8nApiKey(req, res, next) {
  const apiKey = req.headers['x-n8n-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '')
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL
  const configuredKey = process.env.N8N_API_KEY

  if (isProduction && !configuredKey) {
    logger.error('N8N_API_KEY is not configured in production environment')
    return res.status(500).json({
      success: false,
      error: { code: 'CONFIGURATION_ERROR', message: 'Webhook authentication is not configured on server.' }
    })
  }

  const expectedKey = configuredKey || (isProduction ? null : 'dev-n8n-key-change-in-production')

  if (!apiKey || !expectedKey || apiKey !== expectedKey) {
    logger.warn('Unauthorized n8n webhook attempt', { ip: req.ip })
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing X-N8N-API-KEY header.' }
    })
  }

  next()
}

const n8nMessageSchema = z.object({
  wa_message_id: z.string().nullable().optional(),
  phone_number: z.string().min(5, 'Invalid phone number'),
  contact_name: z.string().nullable().optional(),
  direction: z.enum(['inbound', 'outbound']).default('inbound'),
  sender_type: z.enum(['customer', 'ai', 'employee']).default('customer'),
  message_type: z.enum(['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'sticker', 'interactive', 'template', 'reaction', 'unknown']).default('text'),
  content: z.string().nullable().optional().default(''),
  media_url: z.string().nullable().optional(),
  media_mime_type: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  timestamp: z.union([z.string(), z.number()]).nullable().optional(),
  metadata: z.record(z.any()).nullable().optional()
})

const n8nStatusSchema = z.object({
  wa_message_id: z.string(),
  status: z.enum(['pending', 'sent', 'delivered', 'read', 'failed']),
  timestamp: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_detail: z.string().nullable().optional()
})

// GET /api/webhook/n8n/mode/:phone - Query conversation AI/Human mode for n8n workflow routing
router.get('/mode/:phone', requireN8nApiKey, async (req, res, next) => {
  try {
    const rawPhone = req.params.phone.replace(/[^0-9]/g, '')

    let convRes = await query(`
      SELECT id, phone_number, contact_name, mode, status, assigned_to
      FROM public.conversations
      WHERE phone_number = $1 OR phone_number LIKE $2
      LIMIT 1
    `, [rawPhone, `%${rawPhone.slice(-10)}`])

    let conv = convRes.rows[0]

    if (!conv) {
      // Auto-provision conversation in default AI mode
      const insertRes = await query(`
        INSERT INTO public.conversations (phone_number, mode, status)
        VALUES ($1, 'ai', 'open')
        RETURNING id, phone_number, mode, status, contact_name
      `, [rawPhone])

      conv = insertRes.rows[0]
    }

    res.json({
      success: true,
      data: {
        conversation_id: conv.id,
        phone_number: conv.phone_number,
        mode: conv.mode,
        status: conv.status,
        contact_name: conv.contact_name
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/webhook/n8n (and /message, /incoming) - Receive inbound or AI outbound messages from n8n
router.post(['/', '', '/message', '/incoming'], requireN8nApiKey, async (req, res, next) => {
  try {
    const parseResult = n8nMessageSchema.safeParse(req.body)
    if (!parseResult.success) {
      const issues = parseResult.error.issues || parseResult.error.errors || []
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', details: issues }
      })
    }

    const {
      wa_message_id,
      phone_number,
      contact_name,
      direction,
      sender_type,
      message_type,
      content,
      media_url,
      media_mime_type,
      caption,
      timestamp,
      metadata
    } = parseResult.data

    const cleanPhone = phone_number.replace(/[^0-9]/g, '')

    // 1. Deduplication by wa_message_id if present
    if (wa_message_id) {
      const existingRes = await query('SELECT id FROM public.messages WHERE wa_message_id = $1', [wa_message_id])
      if (existingRes.rows.length > 0) {
        return res.json({ success: true, duplicate: true, messageId: existingRes.rows[0].id })
      }
    }

    // 2. Find or create conversation
    let convRes = await query(`
      SELECT id, mode, unread_count, contact_name
      FROM public.conversations
      WHERE phone_number = $1 OR phone_number LIKE $2
      LIMIT 1
    `, [cleanPhone, `%${cleanPhone.slice(-10)}`])

    let conv = convRes.rows[0]
    const textContent = content || ''
    const preview = textContent ? (textContent.length > 80 ? textContent.substring(0, 77) + '...' : textContent) : `[${message_type}]`
    const expiryIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    let conversationId = null

    if (!conv) {
      const convResult = await query(`
        INSERT INTO public.conversations (
          phone_number,
          contact_name,
          mode,
          status,
          unread_count,
          last_message_at,
          last_message_preview,
          wa_window_expires
        ) VALUES ($1, $2, 'ai', 'open', $3, now(), $4, $5)
        RETURNING id
      `, [
        cleanPhone,
        contact_name || cleanPhone,
        direction === 'inbound' ? 1 : 0,
        preview,
        direction === 'inbound' ? expiryIso : null
      ])
      conversationId = convResult.rows[0].id
    } else {
      conversationId = conv.id
      const updates = [
        'last_message_at = now()',
        'last_message_preview = $1',
        "status = 'open'",
        'updated_at = now()'
      ]
      const params = [preview]
      let pIdx = 2

      if (contact_name && contact_name.trim()) {
        updates.push(`contact_name = $${pIdx++}`)
        params.push(contact_name.trim())
      }

      if (direction === 'inbound') {
        updates.push('unread_count = unread_count + 1')
        updates.push(`wa_window_expires = $${pIdx++}`)
        params.push(expiryIso)
      }

      params.push(conversationId)
      await query(`UPDATE public.conversations SET ${updates.join(', ')} WHERE id = $${pIdx}`, params)
    }

    // Determine message creation timestamp (preserve Meta original timestamp if valid)
    let messageCreatedAt = new Date()
    if (timestamp) {
      const tsNum = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10)
      if (!isNaN(tsNum)) {
        const ms = tsNum < 1e11 ? tsNum * 1000 : tsNum
        const d = new Date(ms)
        if (!isNaN(d.getTime())) {
          messageCreatedAt = d
        }
      }
    }

    // 3. Insert message
    const msgResult = await query(`
      INSERT INTO public.messages (
        conversation_id,
        wa_message_id,
        direction,
        sender_type,
        message_type,
        content,
        media_url,
        media_mime_type,
        caption,
        delivery_status,
        metadata,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, created_at
    `, [
      conversationId,
      wa_message_id || null,
      direction,
      sender_type,
      message_type,
      textContent,
      media_url || null,
      media_mime_type || null,
      caption || null,
      direction === 'inbound' ? 'delivered' : 'sent',
      metadata ? JSON.stringify(metadata) : null,
      messageCreatedAt.toISOString()
    ])

    const savedMessage = {
      id: msgResult.rows[0].id,
      conversation_id: conversationId,
      wa_message_id,
      direction,
      sender_type,
      message_type,
      content: textContent,
      media_url,
      caption,
      delivery_status: direction === 'inbound' ? 'delivered' : 'sent',
      created_at: msgResult.rows[0].created_at
    }

    // 4. Real-time broadcast
    sseManager.broadcast('new_message', savedMessage)
    sseManager.broadcast('conversation_update', {
      conversationId,
      last_message_at: savedMessage.created_at,
      last_message_preview: preview,
      direction
    })

    res.status(201).json({
      success: true,
      data: savedMessage
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/webhook/n8n/status - Receive delivery status updates (sent, delivered, read, failed)
router.post('/status', requireN8nApiKey, async (req, res, next) => {
  try {
    const parseResult = n8nStatusSchema.safeParse(req.body)
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', details: parseResult.error.errors }
      })
    }

    const { wa_message_id, status, timestamp, error_code, error_detail } = parseResult.data

    const msgRes = await query('SELECT id, conversation_id FROM public.messages WHERE wa_message_id = $1', [wa_message_id])
    const message = msgRes.rows[0]

    if (message) {
      await query(`
        UPDATE public.messages
        SET delivery_status = $1,
            error_message = $2
        WHERE id = $3
      `, [status, error_detail || null, message.id])

      await query(`
        INSERT INTO public.message_delivery_events (message_id, status, wa_timestamp, error_code, error_detail)
        VALUES ($1, $2, $3, $4, $5)
      `, [message.id, status, timestamp || new Date().toISOString(), error_code || null, error_detail || null])

      sseManager.broadcast('status_update', {
        messageId: message.id,
        conversationId: message.conversation_id,
        wa_message_id,
        status
      })
    }

    res.json({ success: true, updated: Boolean(message) })
  } catch (err) {
    next(err)
  }
})

export default router
