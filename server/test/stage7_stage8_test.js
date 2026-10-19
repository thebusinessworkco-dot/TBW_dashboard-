import assert from 'assert'
import { startServer, stopServer } from '../src/index.js'
import { getDb } from '../src/db/connection.js'

process.env.NODE_ENV = 'test'

const PORT = 3096
const BASE_URL = `http://localhost:${PORT}`
const N8N_KEY = process.env.N8N_API_KEY || 'dev-n8n-key-change-in-production'

let ownerToken = null
let testClientId = null
let testInvoiceId = null
let testPaymentId = null
let testSubscriptionId = null
let testExpenseId = null
let testProjectId = null
let testTaskId = null
let testAppointmentId = null
let testQuoteId = null
let testQuoteToken = null

async function runStage7And8Tests() {
  console.log('\n======================================================')
  console.log('  STAGE 7 (FINANCE) & STAGE 8 (OPERATIONS) TEST SUITE')
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
  // Clean up any test records
  const existingClient = db.prepare("SELECT id FROM clients WHERE whatsapp_phone = '919555666777'").get()
  if (existingClient) {
    const cid = existingClient.id
    db.prepare('DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id = ?)').run(cid)
    db.prepare('DELETE FROM projects WHERE client_id = ?').run(cid)
    db.prepare('DELETE FROM payments WHERE client_id = ?').run(cid)
    db.prepare('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id = ?)').run(cid)
    db.prepare('DELETE FROM invoices WHERE client_id = ?').run(cid)
    db.prepare('DELETE FROM subscriptions WHERE client_id = ?').run(cid)
    db.prepare('DELETE FROM appointments WHERE client_id = ?').run(cid)
    db.prepare('DELETE FROM quotation_items WHERE quotation_id IN (SELECT id FROM quotations WHERE client_id = ?)').run(cid)
    db.prepare('DELETE FROM quotations WHERE client_id = ?').run(cid)
    db.prepare('DELETE FROM lead_events WHERE client_id = ?').run(cid)
    db.prepare('DELETE FROM client_notes WHERE client_id = ?').run(cid)
    db.prepare('DELETE FROM clients WHERE id = ?').run(cid)
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

    // Setup Test Client
    await test('Create Test Client for Finance & Operations', async () => {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
      const res = await fetch(`${BASE_URL}/api/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          name: 'Aditya Birla Retail Partner',
          whatsapp_phone: '919555666777',
          email: 'aditya@birlapartner.in',
          business_name: 'Birla Retail Tech',
          city: 'Bengaluru',
          budget: 150000,
          next_followup: tomorrow
        })
      })
      assert.strictEqual(res.status, 201)
      const data = await res.json()
      testClientId = data.data.id
      assert.ok(testClientId)
    })

    // 2. STAGE 7: Invoices CRUD
    await test('POST /api/invoices creates official invoice with line items', async () => {
      const res = await fetch(`${BASE_URL}/api/invoices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          client_id: testClientId,
          tax_type: 'none',
          tax_rate: 0,
          discount_type: 'fixed',
          discount_value: 5000,
          items: [
            { description: 'WhatsApp AI Agent Implementation', quantity: 1, unit_price: 55000 },
            { description: 'Monthly Retainer Maintenance', quantity: 1, unit_price: 10000 }
          ]
        })
      })

      assert.strictEqual(res.status, 201)
      const body = await res.json()
      assert.strictEqual(body.success, true)
      assert.ok(body.data.id)
      assert.ok(body.data.invoice_number.startsWith('TBW-INV-'))
      // Subtotal = 65000, Discount = 5000 -> Total = 60000 (No GST)
      assert.strictEqual(body.data.total, 60000)
      assert.strictEqual(body.data.balance_due, 60000)
      testInvoiceId = body.data.id
    })

    await test('GET /api/invoices/:id/pdf streams valid invoice PDF', async () => {
      const res = await fetch(`${BASE_URL}/api/invoices/${testInvoiceId}/pdf`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('content-type'), 'application/pdf')
      const buffer = await res.arrayBuffer()
      assert.ok(buffer.byteLength > 1000)
      const header = Buffer.from(buffer.slice(0, 5)).toString()
      assert.strictEqual(header, '%PDF-')
    })

    await test('POST /api/invoices/:id/remind logs payment reminder', async () => {
      const res = await fetch(`${BASE_URL}/api/invoices/${testInvoiceId}/remind`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const body = await res.json()
      assert.strictEqual(body.success, true)
    })

    // 3. STAGE 7: Partial & Full Payments & Receipts
    await test('POST /api/payments records partial payment and updates invoice status', async () => {
      const res = await fetch(`${BASE_URL}/api/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          client_id: testClientId,
          invoice_id: testInvoiceId,
          amount: 30000, // Exactly 50% of 60000
          method: 'upi',
          reference_id: 'UPI-UTR-9876543210'
        })
      })

      assert.strictEqual(res.status, 201)
      const body = await res.json()
      assert.ok(body.data.id)
      assert.ok(body.data.receipt_number.startsWith('TBW-RCP-'))
      testPaymentId = body.data.id

      // Check DB: invoice status should be 'partially_paid', balance_due = 30000
      const inv = db.prepare('SELECT amount_paid, balance_due, status FROM invoices WHERE id = ?').get(testInvoiceId)
      assert.strictEqual(inv.amount_paid, 30000)
      assert.strictEqual(inv.balance_due, 30000)
      assert.strictEqual(inv.status, 'partially_paid')
    })

    await test('POST /api/payments completes second payment and marks invoice paid', async () => {
      const res = await fetch(`${BASE_URL}/api/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          client_id: testClientId,
          invoice_id: testInvoiceId,
          amount: 30000, // Remaining balance
          method: 'bank_transfer',
          reference_id: 'HDFC-IMPS-11223344'
        })
      })

      assert.strictEqual(res.status, 201)

      const inv = db.prepare('SELECT amount_paid, balance_due, status FROM invoices WHERE id = ?').get(testInvoiceId)
      assert.strictEqual(inv.amount_paid, 60000)
      assert.strictEqual(inv.balance_due, 0)
      assert.strictEqual(inv.status, 'paid')
    })

    await test('GET /api/payments/:id/receipt streams PDF receipt', async () => {
      const res = await fetch(`${BASE_URL}/api/payments/${testPaymentId}/receipt`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('content-type'), 'application/pdf')
      const buffer = await res.arrayBuffer()
      assert.ok(buffer.byteLength > 1000)
    })

    // 4. STAGE 7: Subscriptions & MRR
    await test('POST /api/subscriptions creates active subscription and computes MRR', async () => {
      const res = await fetch(`${BASE_URL}/api/subscriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          client_id: testClientId,
          name: 'WhatsApp Bot Managed Retainer',
          monthly_fee: 12000,
          billing_cycle: 'monthly'
        })
      })

      assert.strictEqual(res.status, 201)
      const body = await res.json()
      testSubscriptionId = body.data.id
      assert.strictEqual(body.data.status, 'active')

      // Verify MRR in GET /api/subscriptions
      const listRes = await fetch(`${BASE_URL}/api/subscriptions`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(listRes.status, 200)
      const listData = await listRes.json()
      assert.ok(listData.data.mrr >= 12000)
    })

    await test('POST /api/subscriptions/:id/renew advances next billing date', async () => {
      const res = await fetch(`${BASE_URL}/api/subscriptions/${testSubscriptionId}/renew`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const body = await res.json()
      assert.strictEqual(body.success, true)
      assert.ok(body.data.next_billing)
    })

    // 5. STAGE 7: Expenses & Financial Profitability Analytics
    await test('POST /api/expenses records business operational expense', async () => {
      const res = await fetch(`${BASE_URL}/api/expenses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          category: 'Cloud Infrastructure',
          description: 'VPS Hosting & Meta WhatsApp API Balance',
          amount: 6500,
          vendor: 'Hetzner & Meta'
        })
      })

      assert.strictEqual(res.status, 201)
      const body = await res.json()
      testExpenseId = body.data.id
    })

    await test('GET /api/finance/analytics returns accurate net profit & customer metrics', async () => {
      const res = await fetch(`${BASE_URL}/api/finance/analytics`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const body = await res.json()
      assert.strictEqual(body.success, true)
      const s = body.data.summary
      assert.ok(s.total_collected >= 60000)
      assert.ok(s.total_expenses >= 6500)
      assert.strictEqual(s.net_profit, s.total_collected - s.total_expenses)
      assert.ok(body.data.customer_profitability.length >= 1)
    })

    // 6. STAGE 7: Quotation Improvements (Direct WhatsApp + Replay Protection)
    await test('POST /api/quotations creates quote for WhatsApp dispatch test', async () => {
      const res = await fetch(`${BASE_URL}/api/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          client_id: testClientId,
          package_type: 'WhatsApp AI Customer Support',
          items: [{ description: 'AI Bot Setup', quantity: 1, setup_fee: 45000, monthly_fee: 5000 }]
        })
      })
      assert.strictEqual(res.status, 201)
      const body = await res.json()
      testQuoteId = body.data.id
      testQuoteToken = body.data.acceptance_token
    })

    await test('POST /api/quotations/:id/send-whatsapp preserves provider confirmation rule', async () => {
      const res = await fetch(`${BASE_URL}/api/quotations/${testQuoteId}/send-whatsapp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        }
      })
      assert.strictEqual(res.status, 200)
      const body = await res.json()
      assert.strictEqual(body.success, true)
      assert.ok(body.data.wa_me_url.includes('wa.me'))
      // When live credentials not configured, provider_confirmed is false and status is NOT prematurely marked sent
      if (!body.provider_confirmed) {
        assert.strictEqual(body.reason, 'CREDENTIALS_NOT_CONFIGURED')
      }
    })

    await test('Replay Protection: Second acceptance of quotation returns 409 ALREADY_ACCEPTED', async () => {
      // First acceptance
      const firstRes = await fetch(`${BASE_URL}/api/quotations/accept/${testQuoteToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted_by: 'Aditya Birla Signatory' })
      })
      assert.strictEqual(firstRes.status, 200)

      // Replay attempt
      const secondRes = await fetch(`${BASE_URL}/api/quotations/accept/${testQuoteToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted_by: 'Aditya Birla Signatory' })
      })
      assert.strictEqual(secondRes.status, 409)
      const secondBody = await secondRes.json()
      assert.strictEqual(secondBody.error.code, 'ALREADY_ACCEPTED')
    })

    // 7. STAGE 8: Projects and Tasks
    await test('POST /api/projects creates operational project', async () => {
      const res = await fetch(`${BASE_URL}/api/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          title: 'Retail AI Chatbot Deployment',
          client_id: testClientId,
          budget: 70800,
          deliverables: 'n8n workflow, WhatsApp bot, training'
        })
      })
      assert.strictEqual(res.status, 201)
      const body = await res.json()
      testProjectId = body.data.id
      assert.ok(testProjectId)
    })

    await test('POST /api/projects/:id/tasks and PATCH task status', async () => {
      // Create task
      const res = await fetch(`${BASE_URL}/api/projects/${testProjectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          title: 'Configure Meta Webhook and Gemini Prompts',
          priority: 'urgent',
          status: 'todo'
        })
      })
      assert.strictEqual(res.status, 201)
      const body = await res.json()
      testTaskId = body.data.id

      // Update to done
      const patchRes = await fetch(`${BASE_URL}/api/projects/tasks/${testTaskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({ status: 'done' })
      })
      assert.strictEqual(patchRes.status, 200)

      // Check project task counts
      const projRes = await fetch(`${BASE_URL}/api/projects/${testProjectId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(projRes.status, 200)
      const projData = await projRes.json()
      assert.strictEqual(projData.data.tasks[0].status, 'done')
    })

    // 8. STAGE 8: Appointments and Calendar
    await test('POST & GET /api/appointments schedule and list calendar appointments', async () => {
      const res = await fetch(`${BASE_URL}/api/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          client_id: testClientId,
          title: 'Quarterly AI Strategy Review',
          type: 'proposal_review',
          start_time: '2026-11-01T10:00:00Z',
          end_time: '2026-11-01T10:45:00Z',
          meeting_link: 'https://meet.google.com/tbw-demo'
        })
      })
      assert.strictEqual(res.status, 201)
      const body = await res.json()
      testAppointmentId = body.data.id

      const listRes = await fetch(`${BASE_URL}/api/appointments?client_id=${testClientId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(listRes.status, 200)
      const listData = await listRes.json()
      assert.strictEqual(listData.data.length >= 1, true)
      assert.strictEqual(listData.data[0].id, testAppointmentId)
    })

    // 9. STAGE 8: Quick Replies Full CRUD
    await test('Quick Replies CRUD: POST, PUT, DELETE', async () => {
      // 9a. Create
      const postRes = await fetch(`${BASE_URL}/api/quick-replies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          folder: 'Testing',
          title: 'Special Discount Template',
          content: 'Here is your exclusive 10% agency discount coupon.',
          language: 'English'
        })
      })
      assert.strictEqual(postRes.status, 201)
      const postData = await postRes.json()
      const qrId = postData.data.id

      // 9b. Update
      const putRes = await fetch(`${BASE_URL}/api/quick-replies/${qrId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          folder: 'Testing',
          title: 'Updated Discount Template',
          content: 'Here is your exclusive 15% agency discount coupon.',
          language: 'English'
        })
      })
      assert.strictEqual(putRes.status, 200)

      // 9c. Delete
      const delRes = await fetch(`${BASE_URL}/api/quick-replies/${qrId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(delRes.status, 200)
    })

    // 10. STAGE 8: Notifications & Team Alerts
    await test('POST & PATCH /api/notifications dispatches and marks notifications read', async () => {
      const postRes = await fetch(`${BASE_URL}/api/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          type: 'payment',
          title: 'Invoice Paid: ₹70,800 received',
          body: 'Aditya Birla Retail Partner cleared full invoice balance.'
        })
      })
      assert.strictEqual(postRes.status, 201)
      const postData = await postRes.json()
      const notifId = postData.data.id

      // Mark read
      const patchRes = await fetch(`${BASE_URL}/api/notifications/${notifId}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(patchRes.status, 200)
    })

    // 11. STAGE 8: Automation Monitoring & Client Follow-up Reminders
    await test('GET /api/automation/status returns health and active integrations', async () => {
      const res = await fetch(`${BASE_URL}/api/automation/status`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const body = await res.json()
      assert.strictEqual(body.success, true)
      assert.ok(body.data.total_workflows >= 3)
    })

    await test('GET /api/clients/follow-ups lists pending client reminders', async () => {
      const res = await fetch(`${BASE_URL}/api/clients/follow-ups`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const body = await res.json()
      assert.strictEqual(body.success, true)
      assert.ok(Array.isArray(body.data))
    })

  } finally {
    await stopServer()
  }

  console.log('\n======================================================')
  console.log(`  STAGE 7 & 8 RESULTS: ${passed} PASSED, ${failed} FAILED`)
  console.log('======================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runStage7And8Tests().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
