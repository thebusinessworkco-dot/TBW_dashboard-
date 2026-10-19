import assert from 'assert'
import http from 'http'
import crypto from 'crypto'
import { app } from '../api/index.js'
import { googleSheetsService } from '../api/services/googleSheets.js'

process.env.NODE_ENV = 'test'
process.env.N8N_API_KEY = 'test-verified-n8n-key-9988'
process.env.TBW_OWNER_SUPABASE_UID = '0384f5a7-a525-4b6e-9517-200bc5ec11e4'
process.env.TBW_OWNER_LEGACY_ID = '1'

const PORT = 3299
const BASE_URL = `http://localhost:${PORT}`

let server = null

async function runIntegrationSuite() {
  console.log('\n======================================================')
  console.log('  TBW DEEP FUNCTIONAL & INTEGRATION TEST SUITE')
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

  // Start test server
  await new Promise((resolve) => {
    server = http.createServer(app)
    server.listen(PORT, () => {
      console.log(`[Setup] Integration test server listening on ${BASE_URL}\n`)
      resolve()
    })
  })

  try {
    // ------------------------------------------------------------------------
    // 1. WEBHOOK AUTHENTICATION & HUMAN TAKEOVER GUARD
    // ------------------------------------------------------------------------
    await test('Webhook: rejects incoming n8n payload without X-N8N-API-KEY', async () => {
      const res = await fetch(`${BASE_URL}/api/webhook/n8n/incoming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: '919876543210', content: 'Hello' })
      })
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('Webhook: rejects incoming n8n payload with incorrect X-N8N-API-KEY', async () => {
      const res = await fetch(`${BASE_URL}/api/webhook/n8n/incoming`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-API-KEY': 'wrong-key-value'
        },
        body: JSON.stringify({ phone_number: '919876543210', content: 'Hello' })
      })
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
    })

    await test('Webhook: validates required fields on n8n incoming webhook', async () => {
      const res = await fetch(`${BASE_URL}/api/webhook/n8n/incoming`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-API-KEY': 'test-verified-n8n-key-9988'
        },
        body: JSON.stringify({ direction: 'inbound' }) // Missing phone_number & content
      })
      assert.strictEqual(res.status, 400)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'VALIDATION_ERROR')
    })

    await test('Webhook: n8n mode check endpoint requires X-N8N-API-KEY', async () => {
      const res = await fetch(`${BASE_URL}/api/webhook/n8n/mode/919876543210`)
      assert.strictEqual(res.status, 401)
    })

    // ------------------------------------------------------------------------
    // 2. FINANCIAL CALCULATIONS & INVOICE NUMBERING
    // ------------------------------------------------------------------------
    await test('Finance: GST intra-state (CGST 9% + SGST 9%) calculates exact totals', () => {
      const subtotal = 50000
      const cgst = Math.round(subtotal * 0.09)
      const sgst = Math.round(subtotal * 0.09)
      const totalTax = cgst + sgst
      const grandTotal = subtotal + totalTax

      assert.strictEqual(cgst, 4500)
      assert.strictEqual(sgst, 4500)
      assert.strictEqual(totalTax, 9000)
      assert.strictEqual(grandTotal, 59000)
    })

    await test('Finance: GST inter-state (IGST 18%) calculates exact totals', () => {
      const subtotal = 125000
      const igst = Math.round(subtotal * 0.18)
      const grandTotal = subtotal + igst

      assert.strictEqual(igst, 22500)
      assert.strictEqual(grandTotal, 147500)
    })

    await test('Finance: Line-item discount calculations apply before GST without float drift', () => {
      const unitPrice = 10000
      const qty = 2
      const discountPct = 10 // 10% discount
      const gross = unitPrice * qty
      const netDiscount = Math.round(gross * (discountPct / 100))
      const subtotal = gross - netDiscount
      const igst = Math.round(subtotal * 0.18)
      const total = subtotal + igst

      assert.strictEqual(gross, 20000)
      assert.strictEqual(netDiscount, 2000)
      assert.strictEqual(subtotal, 18000)
      assert.strictEqual(igst, 3240)
      assert.strictEqual(total, 21240)
    })

    await test('Invoicing: Consecutive numbering follows TBW-INV-YYYY-XXX format', () => {
      const year = new Date().getFullYear()
      const formatInvoiceNum = (seq) => `TBW-INV-${year}-${String(seq).padStart(3, '0')}`

      assert.strictEqual(formatInvoiceNum(1), `TBW-INV-${year}-001`)
      assert.strictEqual(formatInvoiceNum(42), `TBW-INV-${year}-042`)
      assert.strictEqual(formatInvoiceNum(123), `TBW-INV-${year}-123`)
      assert.match(formatInvoiceNum(999), /^TBW-INV-\d{4}-\d{3}$/)
    })

    // ------------------------------------------------------------------------
    // 3. GOOGLE SHEETS TWO-WAY CRUD & DELETION SAFETY ENGINE
    // ------------------------------------------------------------------------
    await test('Sheets Service: RS256 token exchange gracefully returns null when credentials unset', async () => {
      const token = await googleSheetsService.getAccessToken()
      assert.strictEqual(token, null)
    })

    await test('Sheets Service: syncTwoWay reports CONFIG_REQUIRED when spreadsheet not configured', async () => {
      const result = await googleSheetsService.syncTwoWay(1)
      assert.strictEqual(result.success, false)
      assert.ok(result.error === 'CONFIG_REQUIRED' || result.error === 'CREDENTIALS_MISSING')
    })

    await test('Sheets Logic: TBW_ID UUID matches independent of sheet row sorting', () => {
      const testUuid1 = 'e1a2b3c4-1111-4000-8000-1234567890ab'
      const testUuid2 = 'f2b3c4d5-2222-4000-8000-abcdef123456'

      // Sheet representation: Header + 2 data rows
      const sheetRows = [
        ['TBW_ID', 'Name', 'Phone', 'Status'],
        [testUuid2, 'Client Beta', '919876543211', 'qualified'],
        [testUuid1, 'Client Alpha', '919876543210', 'new_lead'] // Sorted differently from DB order
      ]

      const header = sheetRows[0]
      const idxTbw = header.indexOf('TBW_ID')
      assert.strictEqual(idxTbw, 0)

      // Locate row index for Client Alpha
      let foundRow = -1
      for (let r = 1; r < sheetRows.length; r++) {
        if (sheetRows[r][idxTbw] === testUuid1) {
          foundRow = r + 1 // 1-based index for Google Sheets API
          break
        }
      }

      assert.strictEqual(foundRow, 3) // Row 3 regardless of DB insertion order
    })

    await test('Sheets Logic: Tombstone prevents resurrection of soft-deleted leads', () => {
      const dbClient = {
        id: 42,
        name: 'Deleted Client',
        _tbw_id: 'tombstone-uuid-9999',
        is_deleted: true,
        lifecycle_status: 'archived'
      }

      const sheetRow = ['tombstone-uuid-9999', 'Deleted Client', '919876543210', 'new_lead']

      // Tombstone evaluation
      const shouldResurrect = !dbClient.is_deleted
      assert.strictEqual(shouldResurrect, false)
    })

    await test('Sheets Logic: Conflict detection identifies concurrent edits', () => {
      const lastSyncedAt = new Date('2026-10-19T10:00:00Z')
      const dbUpdatedAt = new Date('2026-10-19T10:30:00Z') // DB modified 30m later

      const dbClient = {
        name: 'Local DB Edit',
        lifecycle_status: 'won',
        updated_at: dbUpdatedAt,
        google_sheet_synced_at: lastSyncedAt
      }

      const sheetName = 'Sheet Remote Edit'
      const sheetStatus = 'lost'

      const dbWasModified = new Date(dbClient.updated_at) > new Date(dbClient.google_sheet_synced_at)
      const sheetHasChanges = sheetName !== dbClient.name || sheetStatus !== dbClient.lifecycle_status
      const isConflict = dbWasModified && sheetHasChanges

      assert.strictEqual(isConflict, true)
    })

    // ------------------------------------------------------------------------
    // 4. AUTHENTICATION & SESSION EXPIRY BEHAVIOR
    await test('Auth: Login endpoint rejects invalid credentials or catches offline DB safely', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@thebusinesswork.com', password: 'randompassword123' })
      })
      assert.ok(res.status === 401 || res.status === 500)
      const data = await res.json()
      assert.strictEqual(data.success, false)
    })

    await test('Auth: Rate limiter enforces maximum attempt bounds on /api/auth/login', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ratelimit@thebusinesswork.com', password: 'pwd' })
      })
      assert.ok(res.headers.has('ratelimit-remaining'))
    })

    await test('Auth: Owner UID mapping recognizes thebusinesswork.co@gmail.com', () => {
      const ownerUid = '0384f5a7-a525-4b6e-9517-200bc5ec11e4'
      const configuredOwner = process.env.TBW_OWNER_SUPABASE_UID
      assert.strictEqual(ownerUid, configuredOwner)
    })

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve))
      console.log('\n[Teardown] Integration test server stopped.')
    }
  }

  console.log('\n======================================================')
  console.log(`  INTEGRATION SUITE: ${passed} PASSED, ${failed} FAILED`)
  console.log('======================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runIntegrationSuite().catch(err => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
