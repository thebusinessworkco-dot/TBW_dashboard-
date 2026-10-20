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

const n8nLeadSchema = z.object({
  phone: z.string().min(5, 'Invalid phone number'),
  name: z.string().nullable().optional(),
  business: z.string().nullable().optional(),
  service: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  source: z.string().nullable().optional().default('WhatsApp Inbound'),
  received_at: z.string().nullable().optional()
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
    if (timestamp !== undefined && timestamp !== null && timestamp !== '') {
      if (typeof timestamp === 'string' && (timestamp.includes('T') || timestamp.includes('-') || isNaN(Number(timestamp)))) {
        const isoDate = new Date(timestamp)
        if (!isNaN(isoDate.getTime())) {
          messageCreatedAt = isoDate
        }
      } else {
        const tsNum = typeof timestamp === 'number' ? timestamp : Number(timestamp)
        if (!isNaN(tsNum) && tsNum > 0) {
          const ms = tsNum < 1e11 ? tsNum * 1000 : tsNum
          const numDate = new Date(ms)
          if (!isNaN(numDate.getTime())) {
            messageCreatedAt = numDate
          }
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

// POST /api/webhook/n8n/lead - Ingest single qualified lead from n8n into CRM
router.post('/lead', requireN8nApiKey, async (req, res, next) => {
  try {
    const parseResult = n8nLeadSchema.safeParse(req.body)
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', details: parseResult.error.errors }
      })
    }

    const {
      phone,
      name,
      business,
      service,
      purpose,
      language,
      source,
      received_at
    } = parseResult.data

    const cleanPhone = phone.replace(/[^0-9]/g, '')
    if (cleanPhone.length < 7) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_PHONE', message: 'Phone number too short' } })
    }

    // Deduplication check by phone (exact or last 10 digits)
    const existingRes = await query(`
      SELECT id, name, business_name, lifecycle_status, notes, requirement
      FROM public.clients
      WHERE is_deleted = false AND (whatsapp_phone = $1 OR whatsapp_phone LIKE $2)
      LIMIT 1
    `, [cleanPhone, `%${cleanPhone.slice(-10)}`])

    const existing = existingRes.rows[0]

    // Normalize language to allowed enum: 'English' | 'Hindi' | 'Hinglish' | 'Marathi'
    const langNormalized = ['English', 'Hindi', 'Hinglish', 'Marathi'].find(
      l => l.toLowerCase() === (language || '').toLowerCase().trim()
    ) || 'English'

    let clientRecord = null
    let actionTaken = 'created'

    if (existing) {
      // Preserve existing manual edits; only fill in missing fields
      const updates = ['updated_at = CURRENT_TIMESTAMP']
      const params = []
      let pIdx = 1

      if (!existing.business_name && business) {
        updates.push(`business_name = $${pIdx++}`)
        params.push(business)
      }
      if (!existing.requirement && purpose) {
        updates.push(`requirement = $${pIdx++}`)
        params.push(purpose)
      }
      if ((existing.name === 'WhatsApp Contact' || !existing.name) && name && name !== cleanPhone) {
        updates.push(`name = $${pIdx++}`)
        params.push(name)
      }

      params.push(existing.id)
      await query(`UPDATE public.clients SET ${updates.join(', ')} WHERE id = $${pIdx}`, params)
      clientRecord = existing
      actionTaken = 'updated'
    } else {
      const clientName = (name && name.trim()) || 'WhatsApp Contact'
      const insertRes = await query(`
        INSERT INTO public.clients (
          name,
          whatsapp_phone,
          business_name,
          service_category,
          requirement,
          language,
          country,
          lead_source,
          lifecycle_status,
          notes,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, 'India', $7, 'new_lead', $8,
          COALESCE($9::timestamptz, CURRENT_TIMESTAMP),
          CURRENT_TIMESTAMP
        )
        RETURNING id, name, whatsapp_phone, business_name, lifecycle_status
      `, [
        clientName,
        cleanPhone,
        business || null,
        service || 'WhatsApp AI Automation',
        purpose || null,
        langNormalized,
        source || 'WhatsApp Inbound',
        language ? `Captured via WhatsApp bot (${langNormalized})` : 'Captured via WhatsApp bot',
        received_at || null
      ])
      clientRecord = insertRes.rows[0]
      actionTaken = 'created'
    }

    // Link or update conversation contact_name
    await query(`
      UPDATE public.conversations
      SET client_id = $1,
          contact_name = CASE WHEN contact_name IS NULL OR contact_name = phone_number THEN $2 ELSE contact_name END
      WHERE phone_number = $3 OR phone_number LIKE $4
    `, [clientRecord.id, clientRecord.name, cleanPhone, `%${cleanPhone.slice(-10)}`])

    // Broadcast realtime CRM lead event
    sseManager.broadcast('lead_captured', {
      clientId: clientRecord.id,
      name: clientRecord.name,
      phone: cleanPhone,
      business: business || clientRecord.business_name,
      action: actionTaken
    })

    res.json({
      success: true,
      action: actionTaken,
      data: {
        id: clientRecord.id,
        phone: cleanPhone,
        name: clientRecord.name
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/webhook/n8n/sync-leads - Batch sync historical leads from Google Sheets into CRM
router.post('/sync-leads', requireN8nApiKey, async (req, res, next) => {
  try {
    const leads = Array.isArray(req.body) ? req.body : req.body.leads
    if (!Array.isArray(leads)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Expected an array of leads' } })
    }

    let created = 0
    let updated = 0
    let skipped = 0
    let failed = 0
    const errors = []

    for (const item of leads) {
      try {
        const phone = String(item.phone || item.whatsapp_phone || item.Phone || '').replace(/[^0-9]/g, '')
        if (phone.length < 7) {
          skipped++
          continue
        }

        const name = item.name || item.Name || 'WhatsApp Contact'
        const business = item.business || item.Business || item['Business Name'] || null
        const purpose = item.purpose || item.Purpose || item.requirement || null
        const service = item.service || item.Service || 'WhatsApp AI Automation'
        const language = item.language || item.Language || 'English'
        const source = item.source || item.Source || 'Google Sheets Sync'

        const langNormalized = ['English', 'Hindi', 'Hinglish', 'Marathi'].find(
          l => l.toLowerCase() === (language || '').toLowerCase().trim()
        ) || 'English'

        const existingRes = await query(`
          SELECT id, name, business_name, requirement
          FROM public.clients
          WHERE is_deleted = false AND (whatsapp_phone = $1 OR whatsapp_phone LIKE $2)
          LIMIT 1
        `, [phone, `%${phone.slice(-10)}`])

        if (existingRes.rows.length > 0) {
          const ex = existingRes.rows[0]
          // Preserve existing non-empty fields
          const updates = ['updated_at = CURRENT_TIMESTAMP']
          const params = []
          let pIdx = 1

          if (!ex.business_name && business) {
            updates.push(`business_name = $${pIdx++}`)
            params.push(business)
          }
          if (!ex.requirement && purpose) {
            updates.push(`requirement = $${pIdx++}`)
            params.push(purpose)
          }

          params.push(ex.id)
          await query(`UPDATE public.clients SET ${updates.join(', ')} WHERE id = $${pIdx}`, params)
          updated++
        } else {
          await query(`
            INSERT INTO public.clients (
              name,
              whatsapp_phone,
              business_name,
              service_category,
              requirement,
              language,
              country,
              lead_source,
              lifecycle_status,
              notes,
              created_at,
              updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, 'India', $7, 'new_lead', 'Synced from Google Sheets WhatsApp Leads',
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
          `, [name, phone, business, service, purpose, langNormalized, source])
          created++
        }
      } catch (err) {
        failed++
        errors.push(err.message)
      }
    }

    res.json({
      success: true,
      data: {
        total_processed: leads.length,
        created,
        updated,
        skipped,
        failed,
        errors: errors.slice(0, 5)
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
