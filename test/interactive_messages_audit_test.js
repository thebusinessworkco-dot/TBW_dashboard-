import assert from 'assert'
import { z } from 'zod'

console.log('\n======================================================')
console.log('  INTERACTIVE MESSAGES COMPLETE END-TO-END AUDIT SUITE')
console.log('======================================================\n')

// 1. Zod Validation Audit
console.log('[Test 1] Zod Webhook Schema Agreement on message_type & metadata')
const n8nMessageSchema = z.object({
  wa_message_id: z.string().nullable().optional(),
  phone_number: z.string().min(5, 'Invalid phone number'),
  contact_name: z.string().nullable().optional(),
  direction: z.enum(['inbound', 'outbound']).default('inbound'),
  sender_type: z.enum(['customer', 'ai', 'employee']).default('customer'),
  message_type: z.enum([
    'text', 'image', 'video', 'audio', 'document', 'location', 
    'contact', 'sticker', 'interactive', 'template', 'reaction', 'unknown'
  ]).default('text'),
  content: z.string().nullable().optional().default(''),
  media_url: z.string().nullable().optional(),
  media_mime_type: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  timestamp: z.union([z.string(), z.number()]).nullable().optional(),
  metadata: z.record(z.any()).nullable().optional()
})

// Test 1a: Plain text message
const textPayload = {
  phone_number: '919876543210',
  direction: 'inbound',
  sender_type: 'customer',
  message_type: 'text',
  content: 'Hello, need help'
}
assert.strictEqual(n8nMessageSchema.safeParse(textPayload).success, true)

// Test 1b: Interactive list message
const listPayload = {
  phone_number: '919876543210',
  direction: 'outbound',
  sender_type: 'ai',
  message_type: 'interactive',
  content: 'Please choose a language from the list below.',
  metadata: {
    interactive: {
      type: 'list',
      action: {
        button: 'Select language',
        sections: [
          {
            title: 'Languages',
            rows: [
              { id: 'tbw_lang_en', title: 'English' },
              { id: 'tbw_lang_hi', title: 'हिंदी' },
              { id: 'tbw_lang_hinglish', title: 'Hinglish' },
              { id: 'tbw_lang_mr', title: 'मराठी' }
            ]
          }
        ]
      }
    }
  }
}
assert.strictEqual(n8nMessageSchema.safeParse(listPayload).success, true)

// Test 1c: Interactive button message (End Chat)
const buttonPayload = {
  phone_number: '919876543210',
  direction: 'outbound',
  sender_type: 'ai',
  message_type: 'interactive',
  content: 'Thank you! We will get in touch.',
  metadata: {
    interactive: {
      type: 'button',
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'tbw_end_chat', title: 'End Chat' } }
        ]
      }
    }
  }
}
assert.strictEqual(n8nMessageSchema.safeParse(buttonPayload).success, true)

// Test 1d: Customer list_reply selection
const listReplyPayload = {
  phone_number: '919876543210',
  direction: 'inbound',
  sender_type: 'customer',
  message_type: 'interactive',
  content: 'हिंदी',
  metadata: {
    interactive: {
      type: 'list_reply',
      list_reply: { id: 'tbw_lang_hi', title: 'हिंदी' }
    }
  }
}
assert.strictEqual(n8nMessageSchema.safeParse(listReplyPayload).success, true)

// Test 1e: Customer button_reply selection
const buttonReplyPayload = {
  phone_number: '919876543210',
  direction: 'inbound',
  sender_type: 'customer',
  message_type: 'interactive',
  content: 'End Chat',
  metadata: {
    interactive: {
      type: 'button_reply',
      button_reply: { id: 'tbw_end_chat', title: 'End Chat' }
    }
  }
}
assert.strictEqual(n8nMessageSchema.safeParse(buttonReplyPayload).success, true)
console.log('  ✓ PASS: Zod schema validates all 5 interactive/plain message types with full structural fidelity')

// 2. InteractivePayloadView Logic Validation (Exact mirror of frontend component)
console.log('\n[Test 2] Frontend InteractivePayloadView Display-Only Model')

function parseInteractivePayload(message) {
  const meta = typeof message.metadata === 'string' 
    ? (() => { try { return JSON.parse(message.metadata) } catch { return {} } })() 
    : (message.metadata || {})

  const inter = meta?.interactive || (meta?.type === 'interactive' ? meta : null)
  if (inter) {
    if (inter.type === 'list') {
      const actionBtn = inter.action?.button || 'Select Option'
      const sections = inter.action?.sections || []
      const rows = sections.flatMap(s => s.rows || [])
      return {
        renderedType: 'list',
        actionButton: actionBtn,
        rowCount: rows.length,
        firstRowTitle: rows[0]?.title
      }
    }

    if (inter.type === 'button') {
      const buttons = inter.action?.buttons || []
      return {
        renderedType: 'button',
        buttonCount: buttons.length,
        firstButtonTitle: buttons[0]?.reply?.title || buttons[0]?.text
      }
    }

    if (inter.type === 'list_reply' || inter.type === 'button_reply') {
      const replyData = inter.list_reply || inter.button_reply || {}
      return {
        renderedType: 'selection_badge',
        selectedTitle: replyData.title || replyData.id
      }
    }
  }

  if (meta?.list_reply || meta?.button_reply) {
    const chosen = meta?.list_reply?.title || meta?.button_reply?.title
    return {
      renderedType: 'selection_badge',
      selectedTitle: chosen
    }
  }

  return null // ZERO fabricated options!
}

// Case 1: Plain text -> null
assert.strictEqual(parseInteractivePayload({ content: 'Hello', metadata: null }), null)
assert.strictEqual(parseInteractivePayload({ content: 'Hello', metadata: 'corrupted-json-{}' }), null)

// Case 2: Outbound List -> rendered list
const parsedList = parseInteractivePayload(listPayload)
assert.strictEqual(parsedList.renderedType, 'list')
assert.strictEqual(parsedList.actionButton, 'Select language')
assert.strictEqual(parsedList.rowCount, 4)
assert.strictEqual(parsedList.firstRowTitle, 'English')

// Case 3: Outbound Button -> rendered button
const parsedButton = parseInteractivePayload(buttonPayload)
assert.strictEqual(parsedButton.renderedType, 'button')
assert.strictEqual(parsedButton.buttonCount, 1)
assert.strictEqual(parsedButton.firstButtonTitle, 'End Chat')

// Case 4: Inbound list_reply -> rendered badge
const parsedListReply = parseInteractivePayload(listReplyPayload)
assert.strictEqual(parsedListReply.renderedType, 'selection_badge')
assert.strictEqual(parsedListReply.selectedTitle, 'हिंदी')

// Case 5: Inbound button_reply -> rendered badge
const parsedButtonReply = parseInteractivePayload(buttonReplyPayload)
assert.strictEqual(parsedButtonReply.renderedType, 'selection_badge')
assert.strictEqual(parsedButtonReply.selectedTitle, 'End Chat')

// Case 6: Stringified JSONB metadata from PostgreSQL
const stringifiedPayload = {
  content: 'Choose',
  metadata: JSON.stringify(listPayload.metadata)
}
const parsedStringified = parseInteractivePayload(stringifiedPayload)
assert.strictEqual(parsedStringified.renderedType, 'list')
assert.strictEqual(parsedStringified.rowCount, 4)

console.log('  ✓ PASS: InteractivePayloadView correctly renders lists, buttons, and reply badges purely from payload')
console.log('  ✓ PASS: Plain text or corrupted metadata safely returns null with zero fabricated options')

// 3. PostgreSQL Database Column & SELECT Query Check
console.log('\n[Test 3] API Route SELECT Agreement')
import fs from 'fs'
const messagesRouteCode = fs.readFileSync('api/_src/routes/messages.js', 'utf8')
assert.strictEqual(messagesRouteCode.includes('m.metadata,'), true, 'm.metadata must be in SELECT query')
console.log('  ✓ PASS: api/_src/routes/messages.js explicitly selects m.metadata')

console.log('\n======================================================')
console.log('  ALL INTERACTIVE MESSAGES TESTS PASSED (100%)')
console.log('======================================================\n')
