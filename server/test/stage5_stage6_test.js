import assert from 'assert'
import { startServer, stopServer } from '../src/index.js'
import { getDb } from '../src/db/connection.js'

process.env.NODE_ENV = 'test'

const PORT = 3097
const BASE_URL = `http://localhost:${PORT}`

let ownerToken = null
let testClientId = null
let testQuoteId = null
let testAcceptanceToken = null

async function runStage5And6Tests() {
  console.log('\n======================================================')
  console.log('  STAGE 5 (CRM) & STAGE 6 (QUOTATIONS) TEST SUITE')
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

  const db = getDb()
  // Clean up any previous test client / quotations / invoices / projects
  const clientIds = db.prepare("SELECT id FROM clients WHERE whatsapp_phone LIKE '91911122233%'").all().map(r => r.id)
  if (clientIds.length > 0) {
    const placeholders = clientIds.map(() => '?').join(',')
    db.prepare(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id IN (${placeholders}))`).run(...clientIds)
    db.prepare(`DELETE FROM projects WHERE client_id IN (${placeholders})`).run(...clientIds)
    db.prepare(`DELETE FROM invoices WHERE client_id IN (${placeholders})`).run(...clientIds)
    db.prepare(`DELETE FROM quotation_items WHERE quotation_id IN (SELECT id FROM quotations WHERE client_id IN (${placeholders}))`).run(...clientIds)
    db.prepare(`DELETE FROM quotations WHERE client_id IN (${placeholders})`).run(...clientIds)
    db.prepare(`DELETE FROM lead_events WHERE client_id IN (${placeholders})`).run(...clientIds)
    db.prepare(`DELETE FROM client_notes WHERE client_id IN (${placeholders})`).run(...clientIds)
    db.prepare(`DELETE FROM clients WHERE id IN (${placeholders})`).run(...clientIds)
  }

  try {
    // 1. Auth Setup
    await test('Authenticate as Owner', async () => {
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

    // 2. CRM: Create Client / Lead
    await test('POST /api/clients creates new client and records timeline event', async () => {
      const res = await fetch(`${BASE_URL}/api/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          name: 'Rajesh Sharma',
          whatsapp_phone: '+91 91112 22330',
          email: 'rajesh@sharmatech.in',
          business_name: 'Sharma Logistics Solutions',
          industry: 'Logistics & Supply Chain',
          city: 'Mumbai',
          country: 'India',
          language: 'Hindi',
          service_category: 'WhatsApp Automation & CRM',
          requirement: 'Automate tracking updates and lead follow-ups via WhatsApp AI',
          budget: 75000,
          lead_source: 'WhatsApp Inbound',
          lifecycle_status: 'new_lead'
        })
      })

      assert.strictEqual(res.status, 201)
      const body = await res.json()
      assert.strictEqual(body.success, true)
      assert.ok(body.data.id)
      assert.strictEqual(body.data.whatsapp_phone, '919111222330')
      testClientId = body.data.id

      // Verify lead event recorded
      const event = db.prepare('SELECT * FROM lead_events WHERE client_id = ?').get(testClientId)
      assert.ok(event)
      assert.strictEqual(event.event_type, 'lead_created')
    })

    // 3. CRM: Phone Deduplication
    await test('POST /api/clients rejects duplicate WhatsApp phone with 409', async () => {
      const res = await fetch(`${BASE_URL}/api/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          name: 'Rajesh Duplicate',
          whatsapp_phone: '919111222330', // Same sanitized phone
          email: 'different@sharma.in'
        })
      })

      assert.strictEqual(res.status, 409)
      const body = await res.json()
      assert.strictEqual(body.error.code, 'PHONE_EXISTS')
    })

    // 4. CRM: Pipeline Status Transition
    await test('PATCH /api/clients/:id/status updates status and creates timeline entry', async () => {
      const res = await fetch(`${BASE_URL}/api/clients/${testClientId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          status: 'qualified',
          note: 'Client verified scope during discovery call.'
        })
      })

      assert.strictEqual(res.status, 200)
      const body = await res.json()
      assert.strictEqual(body.data.status, 'qualified')

      const updated = db.prepare('SELECT lifecycle_status FROM clients WHERE id = ?').get(testClientId)
      assert.strictEqual(updated.lifecycle_status, 'qualified')

      const event = db.prepare("SELECT * FROM lead_events WHERE client_id = ? AND event_type = 'status_change' ORDER BY id DESC LIMIT 1").get(testClientId)
      assert.ok(event)
      assert.strictEqual(event.from_value, 'new_lead')
      assert.strictEqual(event.to_value, 'qualified')
    })

    // 5. CRM: Add Internal Note
    await test('POST /api/clients/:id/notes appends internal client note', async () => {
      const res = await fetch(`${BASE_URL}/api/clients/${testClientId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          content: 'Interested in WhatsApp catalogue sync alongside AI agent.'
        })
      })

      assert.strictEqual(res.status, 201)
      const body = await res.json()
      assert.strictEqual(body.success, true)
      assert.ok(body.data.id)
    })

    // 6. CRM: Search and Detail View
    await test('GET /api/clients and GET /api/clients/:id returns full profile and timeline', async () => {
      const listRes = await fetch(`${BASE_URL}/api/clients?search=Sharma&status=qualified`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(listRes.status, 200)
      const listData = await listRes.json()
      assert.strictEqual(listData.data.total >= 1, true)
      assert.strictEqual(listData.data.items[0].id, testClientId)

      const detailRes = await fetch(`${BASE_URL}/api/clients/${testClientId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(detailRes.status, 200)
      const detailData = await detailRes.json()
      assert.strictEqual(detailData.data.name, 'Rajesh Sharma')
      assert.strictEqual(detailData.data.notes.length >= 1, true)
      assert.strictEqual(detailData.data.events.length >= 2, true)
    })

    // 7. Quotation: Create Quotation with Setup + Monthly Fees and GST
    await test('POST /api/quotations creates quotation with setup and recurring fees', async () => {
      const res = await fetch(`${BASE_URL}/api/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          client_id: testClientId,
          package_type: 'WhatsApp AI Agent & Multi-Agent CRM Integration',
          scope_of_work: 'Deploy 4-language WhatsApp Cloud API AI bot, n8n automated lead capture, and CRM sync.',
          deliverables: '1. n8n workflow deployment\n2. Meta WhatsApp Cloud webhook integration\n3. TBW Dashboard CRM integration\n4. Staff training session',
          timeline: '14 Working Days',
          payment_milestones: '50% advance upon contract signing, 50% upon UAT sign-off',
          terms: 'Standard agency service agreement. Server hosting & Meta messaging charges billed at actuals.',
          tax_type: 'none',
          tax_rate: 0,
          discount_type: 'fixed',
          discount_value: 5000,
          valid_until: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
          items: [
            {
              description: 'WhatsApp AI Agent Architecture & n8n Workflow Setup',
              quantity: 1,
              setup_fee: 45000,
              monthly_fee: 0
            },
            {
              description: 'Custom CRM Integration & Lead Pipeline Sync',
              quantity: 1,
              setup_fee: 25000,
              monthly_fee: 0
            },
            {
              description: 'Monthly Managed AI Bot Maintenance & SLA Support',
              quantity: 1,
              setup_fee: 0,
              monthly_fee: 6500
            }
          ]
        })
      })

      assert.strictEqual(res.status, 201)
      const body = await res.json()
      assert.strictEqual(body.success, true)
      assert.ok(body.data.id)
      assert.ok(body.data.quotation_number.startsWith('TBW-QT-'))
      assert.ok(body.data.acceptance_token)
      testQuoteId = body.data.id
      testAcceptanceToken = body.data.acceptance_token

      // Verify client lifecycle status moved to proposal_sent
      const client = db.prepare('SELECT lifecycle_status FROM clients WHERE id = ?').get(testClientId)
      assert.strictEqual(client.lifecycle_status, 'proposal_sent')
    })

    // 8. Quotation: Detail and Totals Verification
    await test('GET /api/quotations/:id returns quotation with line items', async () => {
      const res = await fetch(`${BASE_URL}/api/quotations/${testQuoteId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const body = await res.json()
      assert.strictEqual(body.data.items.length, 3)
      assert.strictEqual(body.data.client_name, 'Rajesh Sharma')
      assert.strictEqual(body.data.status, 'draft')
    })

    // 9. Quotation: Stream PDF Document
    await test('GET /api/quotations/:id/pdf generates and streams PDF', async () => {
      const res = await fetch(`${BASE_URL}/api/quotations/${testQuoteId}/pdf`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('content-type'), 'application/pdf')
      const buffer = await res.arrayBuffer()
      assert.ok(buffer.byteLength > 1000, 'PDF buffer should be non-empty')
      // PDF header check: %PDF-
      const header = Buffer.from(buffer.slice(0, 5)).toString()
      assert.strictEqual(header, '%PDF-')
    })

    // 10. Public Acceptance Page & Action
    await test('GET & POST /api/quotations/accept/:token enables public digital acceptance', async () => {
      // 10a. Public fetch without auth
      const getRes = await fetch(`${BASE_URL}/api/quotations/accept/${testAcceptanceToken}`)
      assert.strictEqual(getRes.status, 200)
      const getData = await getRes.json()
      assert.strictEqual(getData.data.quotation_number.startsWith('TBW-QT-'), true)

      // 10b. Public digital sign-off
      const postRes = await fetch(`${BASE_URL}/api/quotations/accept/${testAcceptanceToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted_by: 'Rajesh Sharma (MD)' })
      })
      assert.strictEqual(postRes.status, 200)
      const postData = await postRes.json()
      assert.strictEqual(postData.success, true)

      // Check DB: Quote is accepted, client is 'won'
      const q = db.prepare('SELECT status, accepted_by FROM quotations WHERE id = ?').get(testQuoteId)
      assert.strictEqual(q.status, 'accepted')
      assert.strictEqual(q.accepted_by, 'Rajesh Sharma (MD)')

      const c = db.prepare('SELECT lifecycle_status FROM clients WHERE id = ?').get(testClientId)
      assert.strictEqual(c.lifecycle_status, 'won')
    })

    // 11. Quotation: Convert to Invoice and Project
    await test('POST /api/quotations/:id/convert generates Invoice and Project', async () => {
      const res = await fetch(`${BASE_URL}/api/quotations/${testQuoteId}/convert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const body = await res.json()
      assert.strictEqual(body.success, true)
      assert.ok(body.data.invoiceId)
      assert.ok(body.data.projectId)
      assert.ok(body.data.invoiceNumber.startsWith('TBW-INV-'))

      // Verify invoice in DB
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(body.data.invoiceId)
      assert.ok(inv)
      assert.strictEqual(inv.currency, 'INR')
      assert.strictEqual(inv.client_id, testClientId)
      // Setup fee: (45000 + 25000) = 70000. Discount = 5000. Total = 65000 (No GST)
      assert.strictEqual(inv.subtotal, 70000)
      assert.strictEqual(inv.tax_amount, 0)
      assert.strictEqual(inv.total, 65000)

      // Verify project in DB
      const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(body.data.projectId)
      assert.ok(proj)
      assert.strictEqual(proj.status, 'development')
      assert.strictEqual(proj.client_id, testClientId)
    })

  } finally {
    await stopServer()
  }

  console.log('\n======================================================')
  console.log(`  STAGE 5 & 6 RESULTS: ${passed} PASSED, ${failed} FAILED`)
  console.log('======================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runStage5And6Tests().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
