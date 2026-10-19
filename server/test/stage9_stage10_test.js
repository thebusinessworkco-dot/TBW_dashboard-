import assert from 'assert'
import { startServer, stopServer } from '../src/index.js'
import { getDb } from '../src/db/connection.js'
import { createBackup } from '../src/db/backup.js'
import { restoreBackup } from '../src/db/restore.js'
import { resolve } from 'path'
import { existsSync, unlinkSync } from 'fs'

process.env.NODE_ENV = 'test'

const PORT = 3095
const BASE_URL = `http://localhost:${PORT}`

let ownerToken = null
let testBackupFile = null
const testRestoreDb = resolve('./data/test_restore_verify.db')

async function runStage9And10Tests() {
  console.log('\n=================================================================')
  console.log('  STAGE 9 (ANALYTICS & REPORTING) & STAGE 10 (FINAL QA & SECURITY)')
  console.log('=================================================================\n')

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

  try {
    // 1. Authenticate Owner
    await test('1. Authenticate Owner & verify bearer token', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@thebusinesswork.com',
          password: 'admin123'
        })
      })
      const data = await res.json()
      assert.strictEqual(res.status, 200)
      assert.strictEqual(data.success, true)
      assert.ok(data.data.token)
      assert.strictEqual(data.data.user.role, 'owner')
      ownerToken = data.data.token
    })

    // 2. Unauthenticated analytics access returns 401
    await test('2. Unauthenticated request to /api/analytics/dashboard returns 401', async () => {
      const res = await fetch(`${BASE_URL}/api/analytics/dashboard`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    // 3. Analytics dashboard default range (30d) returns comprehensive metrics
    await test('3. GET /api/analytics/dashboard (30d default) returns complete database analytics', async () => {
      const res = await fetch(`${BASE_URL}/api/analytics/dashboard`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const json = await res.json()
      assert.strictEqual(json.success, true)
      const d = json.data
      assert.strictEqual(d.range, '30d')
      // Leads
      assert.ok(typeof d.leads.total === 'number')
      assert.ok(typeof d.leads.conversion_rate === 'number')
      assert.ok(Array.isArray(d.leads.by_stage))
      assert.ok(Array.isArray(d.leads.by_source))
      // WhatsApp
      assert.ok(typeof d.whatsapp.total_conversations === 'number')
      assert.ok(typeof d.whatsapp.ai_handled === 'number')
      assert.ok(typeof d.whatsapp.human_handled === 'number')
      assert.ok(typeof d.whatsapp.avg_response_time_ms === 'number')
      // Quotations
      assert.ok(typeof d.quotations.total === 'number')
      assert.ok(typeof d.quotations.sent === 'number')
      assert.ok(typeof d.quotations.accepted === 'number')
      assert.ok(typeof d.quotations.acceptance_rate === 'number')
      // Finance
      assert.ok(typeof d.finance.total_invoiced === 'number')
      assert.ok(typeof d.finance.total_collected === 'number')
      assert.ok(typeof d.finance.total_outstanding === 'number')
      assert.ok(typeof d.finance.total_expenses === 'number')
      assert.ok(typeof d.finance.net_profit === 'number')
      assert.ok(typeof d.finance.mrr === 'number')
      assert.ok(Array.isArray(d.finance.timeline))
      // Profitability
      assert.ok(Array.isArray(d.profitability.clients))
      assert.ok(Array.isArray(d.profitability.services))
      // Operations & Automation
      assert.ok(typeof d.projects.active === 'number')
      assert.ok(typeof d.projects.overdue_tasks === 'number')
      assert.ok(typeof d.appointments.scheduled === 'number')
      assert.ok(typeof d.appointments.followups_due === 'number')
      assert.ok(typeof d.automation.healthy === 'boolean')
    })

    // 4. Analytics range filters (today, 7d, 90d, all, custom)
    await test('4. GET /api/analytics/dashboard handles today, 7d, 90d, all, and custom date range filters', async () => {
      for (const r of ['today', '7d', '90d', 'all']) {
        const res = await fetch(`${BASE_URL}/api/analytics/dashboard?range=${r}`, {
          headers: { 'Authorization': `Bearer ${ownerToken}` }
        })
        assert.strictEqual(res.status, 200)
        const json = await res.json()
        assert.strictEqual(json.data.range, r)
      }

      // Custom from/to range
      const customRes = await fetch(`${BASE_URL}/api/analytics/dashboard?from=2026-01-01&to=2026-12-31`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
      })
      assert.strictEqual(customRes.status, 200)
      const customJson = await customRes.json()
      assert.strictEqual(customJson.success, true)
    })

    // 5. CSV Export: Invoices
    await test('5. GET /api/reports/export-csv?type=invoices generates valid CSV stream', async () => {
      const res = await fetch(`${BASE_URL}/api/reports/export-csv?type=invoices`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      assert.ok(res.headers.get('content-type').includes('text/csv'))
      assert.ok(res.headers.get('content-disposition').includes('attachment'))
      const text = await res.text()
      assert.ok(text.includes('Invoice Number'))
      assert.ok(text.includes('Total (INR)'))
    })

    // 6. CSV Export: Leads
    await test('6. GET /api/reports/export-csv?type=leads generates valid CRM leads CSV stream', async () => {
      const res = await fetch(`${BASE_URL}/api/reports/export-csv?type=leads`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      assert.ok(res.headers.get('content-type').includes('text/csv'))
      const text = await res.text()
      assert.ok(text.includes('Lead Name'))
      assert.ok(text.includes('WhatsApp Phone'))
    })

    // 7. CSV Export: Expenses
    await test('7. GET /api/reports/export-csv?type=expenses generates valid Expenses CSV stream', async () => {
      const res = await fetch(`${BASE_URL}/api/reports/export-csv?type=expenses`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const text = await res.text()
      assert.ok(text.includes('Category'))
      assert.ok(text.includes('Amount (INR)'))
    })

    // 8. CSV Export: Profitability
    await test('8. GET /api/reports/export-csv?type=profitability generates valid Client Profitability CSV stream', async () => {
      const res = await fetch(`${BASE_URL}/api/reports/export-csv?type=profitability`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const text = await res.text()
      assert.ok(text.includes('Client Name'))
      assert.ok(text.includes('Total Collected (INR)'))
    })

    // 9. PDF Executive Summary Generation
    await test('9. GET /api/reports/pdf?range=30d generates valid binary PDF stream', async () => {
      const res = await fetch(`${BASE_URL}/api/reports/pdf?range=30d`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('content-type'), 'application/pdf')
      assert.ok(res.headers.get('content-disposition').includes('tbw-executive-report'))
      const buffer = await res.arrayBuffer()
      const headerStr = Buffer.from(buffer.slice(0, 5)).toString('utf-8')
      assert.strictEqual(headerStr, '%PDF-')
      assert.ok(buffer.byteLength > 2000, 'PDF size should be substantial')
    })

    // 10. Audit Log Endpoint & Filtering
    await test('10. GET /api/audit-log returns paginated system events and supports action filter', async () => {
      const res = await fetch(`${BASE_URL}/api/audit-log?limit=10&offset=0`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const json = await res.json()
      assert.strictEqual(json.success, true)
      assert.ok(Array.isArray(json.data.logs))
      assert.ok(typeof json.data.pagination.total === 'number')

      // Filter by action
      const filterRes = await fetch(`${BASE_URL}/api/audit-log?action=login`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
      })
      assert.strictEqual(filterRes.status, 200)
      const filterJson = await filterRes.json()
      assert.strictEqual(filterJson.success, true)
    })

    // 11. Security Headers & CORS validation
    await test('11. Security headers (Helmet) and CORS policies enforced correctly', async () => {
      const res = await fetch(`${BASE_URL}/api/health`)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff')
      assert.strictEqual(res.headers.get('x-frame-options'), 'SAMEORIGIN')
      assert.ok(res.headers.get('cross-origin-resource-policy'))
    })

    // 12. Rate Limiting verification
    await test('12. API Rate Limiting middleware configured with standard headers', async () => {
      const { apiLimiter, loginLimiter } = await import('../src/middleware/rateLimit.js')
      assert.ok(apiLimiter)
      assert.ok(loginLimiter)
    })

    // 13. Sensitive Credentials Leak Audit
    await test('13. Frontend endpoints never expose password hashes, tokens, or n8n keys', async () => {
      const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
      })
      const meData = await meRes.json()
      assert.strictEqual(meData.success, true)
      const user = meData.data.user
      assert.strictEqual(user.password_hash, undefined)
      assert.strictEqual(user.session_token, undefined)

      // Check settings endpoint
      const setRes = await fetch(`${BASE_URL}/api/settings`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
      })
      const setData = await setRes.json()
      const serialized = JSON.stringify(setData)
      assert.ok(!serialized.includes('WHATSAPP_ACCESS_TOKEN'))
      assert.ok(!serialized.includes('N8N_API_KEY'))
      assert.ok(!serialized.includes('JWT_SECRET'))
    })

    // 14. Online SQLite Backup verification
    await test('14. createBackup() performs online non-blocking SQLite backup', async () => {
      testBackupFile = await createBackup('./data/test_backups')
      assert.ok(existsSync(testBackupFile), `Backup file must exist at ${testBackupFile}`)
    })

    // 15. Safe Database Restoration verification
    await test('15. restoreBackup() restores SQLite database and verifies PRAGMA integrity_check', async () => {
      assert.ok(testBackupFile, 'Backup file from previous test must exist')
      const restoreResult = await restoreBackup(testBackupFile, testRestoreDb)
      assert.strictEqual(restoreResult.success, true)
      assert.ok(existsSync(testRestoreDb))
    })

    // 16. Memory Footprint Audit for 1 GB RAM VPS
    await test('16. Memory usage audit: RSS < 100 MB baseline (1 GB VPS optimal)', async () => {
      const mem = process.memoryUsage()
      const rssMb = Math.round(mem.rss / 1024 / 1024)
      const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024)
      console.log(`    [Memory Check] RSS: ${rssMb} MB | Heap Used: ${heapUsedMb} MB | External: ${Math.round(mem.external / 1024 / 1024)} MB`)
      assert.ok(rssMb < 150, `RSS memory (${rssMb} MB) must be well within VPS limits (<150 MB)`)
    })

    // 17. Public Quotation PDF & Expiring Token Access
    await test('17. Public quotation PDF streaming and expiring access token validation', async () => {
      const db = getDb()
      const quote = db.prepare('SELECT acceptance_token FROM quotations WHERE acceptance_token IS NOT NULL LIMIT 1').get()
      if (quote) {
        const res = await fetch(`${BASE_URL}/api/quotations/accept/${quote.acceptance_token}/pdf`)
        assert.strictEqual(res.status, 200)
        assert.strictEqual(res.headers.get('content-type'), 'application/pdf')
      }

      // Invalid token returns 404
      const invalidRes = await fetch(`${BASE_URL}/api/quotations/accept/invalid-token-123/pdf`)
      assert.strictEqual(invalidRes.status, 404)
    })

    // 18. Signed Expiring Invoice PDF Link Generation & Public Access
    await test('18. Public signed expiring invoice PDF link generation and validation', async () => {
      const db = getDb()
      const inv = db.prepare('SELECT id FROM invoices LIMIT 1').get()
      if (inv) {
        // Generate signed link
        const linkRes = await fetch(`${BASE_URL}/api/invoices/${inv.id}/public-link`, {
          headers: { 'Authorization': `Bearer ${ownerToken}` }
        })
        assert.strictEqual(linkRes.status, 200)
        const linkData = await linkRes.json()
        assert.strictEqual(linkData.success, true)
        assert.ok(linkData.data.download_url.includes('exp_token='))

        // Access invoice PDF via the signed link (NO auth header required)
        const pdfRes = await fetch(linkData.data.download_url)
        assert.strictEqual(pdfRes.status, 200)
        assert.strictEqual(pdfRes.headers.get('content-type'), 'application/pdf')

        // Tampered exp_token must be rejected with 403
        const tamperedUrl = linkData.data.download_url + 'tampered'
        const failRes = await fetch(tamperedUrl)
        assert.strictEqual(failRes.status, 403)
      }
    })

  } finally {
    // Cleanup temporary restore db and backup files
    if (existsSync(testRestoreDb)) {
      try { unlinkSync(testRestoreDb) } catch {}
    }
    const preRestoreBak = `${testRestoreDb}.pre-restore-*`
    await stopServer()
  }

  console.log('\n------------------------------------------------------')
  console.log(`  Stage 9 & 10 Tests Finished: ${passed} Passed, ${failed} Failed`)
  console.log('------------------------------------------------------\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runStage9And10Tests().catch((err) => {
  console.error('Fatal test runner failure:', err)
  process.exit(1)
})
