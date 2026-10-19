import assert from 'assert'
import { startServer, stopServer } from '../src/index.js'
import { getDb } from '../src/db/connection.js'

process.env.NODE_ENV = 'test'

const PORT = 3098
const BASE_URL = `http://localhost:${PORT}`
const N8N_KEY = process.env.N8N_API_KEY || 'dev-n8n-key-change-in-production'

let ownerToken = null
let testConvId = null

async function runStage4Tests() {
  console.log('\n======================================================')
  console.log('  STAGE 4: WHATSAPP INBOX & N8N INTEGRATION TEST SUITE')
  console.log('======================================================\n')

  let passed = 0
  let failed = 0

  async function test(name, fn) {
    try {
      console.log(`[Testing] ${name}`)
      await fn()
      console.log(`  ✓ PASS: ${name}`)
      passed++
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`)
      console.error(`    Error: ${err.message}`)
      if (err.stack) console.error(`    ${err.stack.split('\n')[1]}`)
      failed++
    }
  }

  await startServer(PORT)

  // Ensure clean state for test phone number
  const db = getDb()
  db.prepare("DELETE FROM conversations WHERE phone_number LIKE '%919876543210%'").run()
  db.prepare("DELETE FROM messages WHERE wa_message_id LIKE '%HBgMOTE5ODc2NTQzMjEwFQIAEhgWM0VCMEYzRDQ1OTZBQzU4MDY5%'").run()

  try {
    // 1. Authenticate as owner to test protected inbox routes
    await test('Authenticate as owner for WhatsApp inbox management', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@thebusinesswork.com', password: 'admin123' })
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      ownerToken = data.data.token
      assert.ok(ownerToken)
    })

    // 2. Webhook Security: unauthorized access rejected
    await test('GET /api/webhook/n8n/mode/:phone without X-N8N-API-KEY returns 401', async () => {
      const res = await fetch(`${BASE_URL}/api/webhook/n8n/mode/919876543210`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    // 3. n8n checks conversation mode (auto-provisions in AI mode)
    await test('GET /api/webhook/n8n/mode/:phone with API key auto-provisions and returns mode=ai', async () => {
      const res = await fetch(`${BASE_URL}/api/webhook/n8n/mode/919876543210`, {
        headers: { 'X-N8N-API-KEY': N8N_KEY }
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.strictEqual(data.success, true)
      assert.strictEqual(data.data.mode, 'ai')
      assert.ok(data.data.conversation_id)
      testConvId = data.data.conversation_id
    })

    // 4. n8n posts incoming customer WhatsApp message
    await test('POST /api/webhook/n8n/message records inbound customer message & activates 24h window', async () => {
      const res = await fetch(`${BASE_URL}/api/webhook/n8n/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-API-KEY': N8N_KEY
        },
        body: JSON.stringify({
          wa_message_id: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgWM0VCMEYzRDQ1OTZBQzU4MDY5',
          phone_number: '919876543210',
          contact_name: 'Vikram Malhotra',
          direction: 'inbound',
          sender_type: 'customer',
          message_type: 'text',
          content: 'Hi, I need an AI sales agent for my real estate agency.'
        })
      })
      assert.strictEqual(res.status, 201)
      const data = await res.json()
      assert.strictEqual(data.success, true)
      assert.strictEqual(data.data.direction, 'inbound')
      assert.strictEqual(data.data.sender_type, 'customer')
    })

    // 5. Message Deduplication: Identical wa_message_id is not duplicated
    await test('POST /api/webhook/n8n/message prevents duplicate processing of same wa_message_id', async () => {
      const res = await fetch(`${BASE_URL}/api/webhook/n8n/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-API-KEY': N8N_KEY
        },
        body: JSON.stringify({
          wa_message_id: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgWM0VCMEYzRDQ1OTZBQzU4MDY5',
          phone_number: '919876543210',
          content: 'Hi, I need an AI sales agent for my real estate agency.'
        })
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.strictEqual(data.duplicate, true)
    })

    // 6. Inbox Conversation List: verifies unread count, customer name, 24h window
    await test('GET /api/conversations lists conversations with active 24h window and unread count', async () => {
      const res = await fetch(`${BASE_URL}/api/conversations`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      const conv = data.data.items.find(c => c.id === testConvId)
      assert.ok(conv)
      assert.strictEqual(conv.contact_name, 'Vikram Malhotra')
      assert.strictEqual(conv.unread_count, 1)
      assert.strictEqual(conv.is_window_active, true)
      assert.strictEqual(conv.mode, 'ai')
    })

    // 7. Read Messages & reset unread count
    await test('GET /api/conversations/:id/messages returns thread and resets unread count to 0', async () => {
      const res = await fetch(`${BASE_URL}/api/conversations/${testConvId}/messages`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.ok(data.data.items.length >= 1)
      assert.strictEqual(data.data.items[0].content, 'Hi, I need an AI sales agent for my real estate agency.')

      // Check that unread count was reset
      const convRes = await fetch(`${BASE_URL}/api/conversations/${testConvId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      const convData = await convRes.json()
      assert.strictEqual(convData.data.unread_count, 0)
    })

    // 8. Human Takeover Mode Toggle
    await test('PATCH /api/conversations/:id/mode switches conversation to human takeover', async () => {
      const res = await fetch(`${BASE_URL}/api/conversations/${testConvId}/mode`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({ mode: 'human' })
      })
      assert.strictEqual(res.status, 200)

      // n8n checks mode endpoint -> returns human!
      const modeCheck = await fetch(`${BASE_URL}/api/webhook/n8n/mode/919876543210`, {
        headers: { 'X-N8N-API-KEY': N8N_KEY }
      })
      const modeData = await modeCheck.json()
      assert.strictEqual(modeData.data.mode, 'human')
    })

    // 9. Employee sends manual reply (Human mode)
    await test('POST /api/conversations/:id/messages sends manual employee response', async () => {
      const res = await fetch(`${BASE_URL}/api/conversations/${testConvId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          content: 'Hello Vikram! We specialize in AI agents for real estate agencies. Let us share our demo.',
          message_type: 'text'
        })
      })
      assert.strictEqual(res.status, 201)
      const data = await res.json()
      assert.strictEqual(data.data.sender_type, 'employee')
      // Must be pending without provider credentials
      assert.strictEqual(data.data.delivery_status, 'pending')
      const outboundWaId = data.data.wa_message_id

      // Test provider status webhook updates status to delivered and read
      const statusRes = await fetch(`${BASE_URL}/api/webhook/n8n/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-API-KEY': N8N_KEY
        },
        body: JSON.stringify({
          wa_message_id: outboundWaId,
          status: 'delivered'
        })
      })
      assert.strictEqual(statusRes.status, 200)
    })

    // 10. Meta Delivery Status Updates
    await test('POST /api/webhook/n8n/status updates message delivery status to read', async () => {
      const res = await fetch(`${BASE_URL}/api/webhook/n8n/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-API-KEY': N8N_KEY
        },
        body: JSON.stringify({
          wa_message_id: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgWM0VCMEYzRDQ1OTZBQzU4MDY5',
          status: 'read'
        })
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.strictEqual(data.success, true)
    })

    // 11. WhatsApp 24-hour customer service window enforcement
    await test('Sending standard message outside 24h window returns 400 WINDOW_EXPIRED', async () => {
      const db = getDb()
      // Artificially expire the window
      db.prepare("UPDATE conversations SET wa_window_expires = datetime('now', '-1 hour') WHERE id = ?").run(testConvId)

      const res = await fetch(`${BASE_URL}/api/conversations/${testConvId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({ content: 'Testing message after window expired' })
      })
      assert.strictEqual(res.status, 400)
      const data = await res.json()
      assert.strictEqual(data.error.code, 'WINDOW_EXPIRED')
    })

    // 12. Quick Replies Management
    await test('GET /api/quick-replies returns pre-seeded agency response templates', async () => {
      const res = await fetch(`${BASE_URL}/api/quick-replies`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.ok(data.data.length >= 4)
      const titles = data.data.map(q => q.title)
      assert.ok(titles.includes('Standard Welcome'))
      assert.ok(titles.includes('AI Agents Overview'))
    })

  } finally {
    console.log('\n[Teardown] Stopping Stage 4 test server...')
    await stopServer()
  }

  console.log('\n======================================================')
  console.log(`  STAGE 4 RESULTS: ${passed} passed, ${failed} failed`)
  console.log('======================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runStage4Tests().catch(err => {
  console.error('Stage 4 test runner fatal error:', err)
  process.exit(1)
})
