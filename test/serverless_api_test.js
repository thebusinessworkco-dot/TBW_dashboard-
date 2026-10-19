import assert from 'assert'
import http from 'http'
import crypto from 'crypto'
import { app } from '../api/index.js'
import { getPostgresSslConfig, buildPgPoolConfig } from '../api/_src/_lib/db.js'

process.env.NODE_ENV = 'test'
process.env.N8N_API_KEY = 'test-n8n-key-12345'
process.env.SESSION_SECRET = 'test-secret-min-32-chars-long-abcdef123456'

const PORT = 3199
const BASE_URL = `http://localhost:${PORT}`

let server = null

async function runTests() {
  console.log('\n======================================================')
  console.log('  TBW SERVERLESS EXPRESS & ROUTING TEST SUITE')
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
      console.log(`[Setup] Test server listening on ${BASE_URL}`)
      resolve()
    })
  })

  try {
    // 1. Health & Serverless Diagnostics
    await test('GET /api/health returns 200 or 503 with serverless runtime metadata', async () => {
      const res = await fetch(`${BASE_URL}/api/health`)
      const data = await res.json()
      assert.strictEqual(data.service, 'tbw-dashboard-api')
      assert.strictEqual(data.runtime, 'vercel-serverless-nodejs')
      assert.strictEqual(data.version, '14.0.0')
      assert.ok(data.database)
      assert.strictEqual(data.database.driver, 'pg-pool')
    })

    // 2. Direct mount /health (handling Vercel stripped prefixes)
    await test('GET /health (stripped prefix) routes correctly via shared apiRouter', async () => {
      const res = await fetch(`${BASE_URL}/health`)
      const data = await res.json()
      assert.strictEqual(data.service, 'tbw-dashboard-api')
      assert.strictEqual(data.runtime, 'vercel-serverless-nodejs')
    })

    // 3. CORS Preflight & Headers
    await test('OPTIONS /api/clients returns allowed CORS headers', async () => {
      const res = await fetch(`${BASE_URL}/api/clients`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://dashboard.thebusinesswork.com',
          'Access-Control-Request-Method': 'GET'
        }
      })
      assert.strictEqual(res.headers.get('access-control-allow-origin'), 'https://dashboard.thebusinesswork.com')
      assert.strictEqual(res.headers.get('access-control-allow-credentials'), 'true')
    })

    // 4. Rate Limiting Headers
    await test('API requests return standard RateLimit headers', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/me`)
      assert.ok(res.headers.has('ratelimit-limit'))
      assert.ok(res.headers.has('ratelimit-remaining'))
    })

    // 5. Auth Protection on Privileged Endpoints
    await test('Privileged endpoint /api/clients requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/clients`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('Privileged endpoint /api/invoices requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/invoices`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('Privileged endpoint /api/quotations requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/quotations`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('Privileged endpoint /api/team requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/team`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('Privileged endpoint /api/finance/analytics requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/finance/analytics`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('Privileged endpoint /api/projects requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/projects`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('Privileged endpoint /api/appointments requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/appointments`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('POST /api/clients/sync-sheets requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/clients/sync-sheets`, { method: 'POST' })
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('GET /api/clients/sync-status requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/clients/sync-status`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('GET /api/clients/trash requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/clients/trash`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('GET /api/clients/export-csv requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/clients/export-csv`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    // 6. Zod Schema Validation
    await test('POST /api/auth/login validates required fields with Zod (400)', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email' })
      })
      assert.strictEqual(res.status, 400)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'VALIDATION_ERROR')
    })

    // 7. n8n Webhook Security & Idempotency
    await test('POST /api/webhook/n8n/incoming rejects missing X-N8N-API-KEY (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/webhook/n8n/incoming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '919876543210', content: 'Hello' })
      })
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    await test('POST /api/webhook/n8n/incoming rejects invalid X-N8N-API-KEY (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/webhook/n8n/incoming`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-n8n-api-key': 'wrong-key'
        },
        body: JSON.stringify({ phone: '919876543210', content: 'Hello' })
      })
      assert.strictEqual(res.status, 401)
    })

    // 8. SSE Serverless-Safe Behavior
    await test('GET /api/sse/events requires authentication (401)', async () => {
      const res = await fetch(`${BASE_URL}/api/sse/events`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    // 9. Public Services Catalog
    await test('GET /api/services is publicly accessible (when db connected) or catches safely', async () => {
      const res = await fetch(`${BASE_URL}/api/services`)
      // Should either return 200 (if DB alive) or 500 error handled gracefully by errorHandler
      assert.ok(res.status === 200 || res.status === 500)
      const data = await res.json()
      assert.ok('success' in data)
    })

    // 10. 404 Handler
    await test('Non-existent route returns standard 404 NOT_FOUND response', async () => {
      const res = await fetch(`${BASE_URL}/api/non_existent_route_${Date.now()}`)
      assert.strictEqual(res.status, 404)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'NOT_FOUND')
    })

    // 11. Serverless PostgreSQL SSL Configuration
    await test('Serverless DB: getPostgresSslConfig enforces rejectUnauthorized: true with Supabase CAs', async () => {
      const remoteUrl = 'postgresql://postgres.fbyyjmxrkizlpmxakkdo:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require'
      const ssl = getPostgresSslConfig(remoteUrl)
      assert.strictEqual(ssl.rejectUnauthorized, true)
      assert.strictEqual(ssl.servername, 'aws-0-ap-southeast-2.pooler.supabase.com')
      assert.ok(Array.isArray(ssl.ca))

      const hasIntermediate = ssl.ca.some(certPem => {
        try {
          const x509 = new crypto.X509Certificate(certPem)
          return x509.subject.includes('Supabase Intermediate 2021 CA')
        } catch {
          return false
        }
      })
      assert.strictEqual(hasIntermediate, true, 'Supabase Intermediate 2021 CA must be in trusted CA list')

      const hasRoot = ssl.ca.some(certPem => {
        try {
          const x509 = new crypto.X509Certificate(certPem)
          return x509.subject.includes('Supabase Root 2021 CA')
        } catch {
          return false
        }
      })
      assert.strictEqual(hasRoot, true, 'Supabase Root 2021 CA must be in trusted CA list')
    })

    // 12. Serverless PostgreSQL Pool Config Builder
    await test('Serverless DB: buildPgPoolConfig safely strips sslmode and prevents SSL override collisions', async () => {
      const remoteUrl = 'postgresql://myuser:mypass@aws-0-ap-southeast-2.pooler.supabase.com:6543/mydatabase?sslmode=require'
      const config = buildPgPoolConfig(remoteUrl)
      assert.strictEqual(config.host, 'aws-0-ap-southeast-2.pooler.supabase.com')
      assert.strictEqual(config.port, 6543)
      assert.strictEqual(config.user, 'myuser')
      assert.strictEqual(config.password, 'mypass')
      assert.strictEqual(config.database, 'mydatabase')
      assert.strictEqual(config.ssl.rejectUnauthorized, true)
      assert.strictEqual(config.ssl.servername, 'aws-0-ap-southeast-2.pooler.supabase.com')
      assert.strictEqual(config.connectionString, undefined)
    })

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve))
      console.log('\n[Teardown] Test server stopped.')
    }
  }

  console.log('\n======================================================')
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`)
  console.log('======================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Fatal test runner error:', err)
  process.exit(1)
})
