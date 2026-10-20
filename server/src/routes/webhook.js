import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
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
router.get('/mode/:phone', requireN8nApiKey, (req, res, next) => {
  try {
    const rawPhone = req.params.phone.replace(/[^0-9]/g, '')
    const db = getDb()

    let conv = db.prepare(`
      SELECT id, phone_number, contact_name, mode, status, assigned_to
      FROM conversations
      WHERE phone_number = ? OR phone_number LIKE ?
    `).get(rawPhone, `%${rawPhone.slice(-10)}`)

    if (!conv) {
      // Auto-provision conversation in default AI mode
      const result = db.prepare(`
        INSERT INTO conversations (phone_number, mode, status)
        VALUES (?, 'ai', 'open')
      `).run(rawPhone)

      conv = {
        id: result.lastInsertRowid,
        phone_number: rawPhone,
        mode: 'ai',
        status: 'open'
      }
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
router.post(['/', '', '/message', '/incoming'], requireN8nApiKey, (req, res, next) => {
  try {
    const parseResult = n8nMessageSchema.safeParse(req.body)
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', details: parseResult.error.errors }
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
      metadata
    } = parseResult.data

    const cleanPhone = phone_number.replace(/[^0-9]/g, '')
    const db = getDb()

    // 1. Deduplication by wa_message_id if present
    if (wa_message_id) {
      const existing = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(wa_message_id)
      if (existing) {
        return res.json({ success: true, duplicate: true, messageId: existing.id })
      }
    }

    // 2. Find or create conversation
    let conv = db.prepare(`
      SELECT id, mode, unread_count, contact_name
      FROM conversations
      WHERE phone_number = ? OR phone_number LIKE ?
    `).get(cleanPhone, `%${cleanPhone.slice(-10)}`)

    const preview = content ? (content.length > 80 ? content.substring(0, 77) + '...' : content) : `[${message_type}]`

    const nowIso = new Date().toISOString()
    const expiryIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    let conversationId = null

    if (!conv) {
      const convResult = db.prepare(`
        INSERT INTO conversations (
          phone_number,
          contact_name,
          mode,
          status,
          unread_count,
          last_message_at,
          last_message_preview,
          wa_window_expires
        ) VALUES (?, ?, 'ai', 'open', ?, datetime('now'), ?, ?)
      `).run(
        cleanPhone,
        contact_name || cleanPhone,
        direction === 'inbound' ? 1 : 0,
        preview,
        direction === 'inbound' ? expiryIso : null
      )
      conversationId = convResult.lastInsertRowid
    } else {
      conversationId = conv.id
      const updates = [
        "last_message_at = datetime('now')",
        "last_message_preview = ?",
        "status = 'open'",
        "updated_at = datetime('now')"
      ]
      const params = [preview]

      if (contact_name && !conv.contact_name) {
        updates.push('contact_name = ?')
        params.push(contact_name)
      }

      if (direction === 'inbound') {
        updates.push('unread_count = unread_count + 1')
        updates.push('wa_window_expires = ?')
        params.push(expiryIso)
      }

      params.push(conversationId)
      db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    // 3. Insert message
    const msgResult = db.prepare(`
      INSERT INTO messages (
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
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversationId,
      wa_message_id || null,
      direction,
      sender_type,
      message_type,
      content,
      media_url || null,
      media_mime_type || null,
      caption || null,
      direction === 'inbound' ? 'delivered' : 'sent',
      metadata ? JSON.stringify(metadata) : null
    )

    const savedMessage = {
      id: msgResult.lastInsertRowid,
      conversation_id: conversationId,
      wa_message_id,
      direction,
      sender_type,
      message_type,
      content,
      media_url,
      caption,
      delivery_status: direction === 'inbound' ? 'delivered' : 'sent',
      created_at: nowIso
    }

    // 4. Real-time broadcast to dashboard via SSE
    sseManager.broadcast('new_message', savedMessage)
    sseManager.broadcast('conversation_update', {
      conversationId,
      last_message_at: nowIso,
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
router.post('/status', requireN8nApiKey, (req, res, next) => {
  try {
    const parseResult = n8nStatusSchema.safeParse(req.body)
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', details: parseResult.error.errors }
      })
    }

    const { wa_message_id, status, timestamp, error_code, error_detail } = parseResult.data
    const db = getDb()

    const message = db.prepare('SELECT id, conversation_id FROM messages WHERE wa_message_id = ?').get(wa_message_id)

    if (message) {
      db.prepare(`
        UPDATE messages
        SET delivery_status = ?,
            error_message = ?
        WHERE id = ?
      `).run(status, error_detail || null, message.id)

      db.prepare(`
        INSERT INTO message_delivery_events (message_id, status, wa_timestamp, error_code, error_detail)
        VALUES (?, ?, ?, ?, ?)
      `).run(message.id, status, timestamp || new Date().toISOString(), error_code || null, error_detail || null)

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
