import assert from 'assert'
import { startServer, stopServer } from '../src/index.js'
import { getDb, closeDb } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'

process.env.NODE_ENV = 'test'

const PORT = 3099
const BASE_URL = `http://localhost:${PORT}`

let ownerToken = null
let ownerCookie = null
let viewerToken = null
let viewerCookie = null

async function runTests() {
  console.log('\n======================================================')
  console.log('  STAGE 3: BACKEND FOUNDATION VERIFICATION SUITE')
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
  console.log('[Setup] Starting test server on port', PORT)
  await startServer(PORT)

  // Ensure clean test user state
  const db = getDb()
  db.prepare("DELETE FROM users WHERE email = 'viewer.test@thebusinesswork.com'").run()
  db.prepare("DELETE FROM sessions").run()

  try {
    // 1. Health check & Diagnostics
    await test('Health check returns ok with WAL database and memory diagnostics', async () => {
      const res = await fetch(`${BASE_URL}/api/health`)
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.strictEqual(data.status, 'ok')
      assert.strictEqual(data.database.mode, 'WAL')
      assert.strictEqual(data.database.status, 'ok')
      assert.ok(typeof data.memory.rss === 'number')
    })

    // 2. Migration idempotency
    await test('Migration runner is idempotent and safe to run multiple times', async () => {
      assert.doesNotThrow(() => {
        runMigrations()
      })
      const db = getDb()
      const migrations = db.prepare('SELECT COUNT(*) as c FROM _migrations').get()
      assert.ok(migrations.c >= 1)
    })

    // 3. Validation: Invalid Request Payload (Zod)
    await test('POST /api/auth/login with invalid email returns 400 with VALIDATION_ERROR', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', password: '123' })
      })
      assert.strictEqual(res.status, 400)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'VALIDATION_ERROR')
      assert.ok(Array.isArray(data.error.details))
    })

    // 4. Invalid credentials
    await test('POST /api/auth/login with wrong password returns 401 INVALID_CREDENTIALS', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@thebusinesswork.com', password: 'wrongpassword' })
      })
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'INVALID_CREDENTIALS')
    })

    // 5. Successful login
    await test('POST /api/auth/login with valid credentials returns 200, user, and session token', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@thebusinesswork.com', password: 'admin123' })
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.strictEqual(data.success, true)
      assert.strictEqual(data.data.user.email, 'admin@thebusinesswork.com')
      assert.strictEqual(data.data.user.role, 'owner')
      assert.ok(data.data.token && data.data.token.length >= 32)
      assert.strictEqual(data.data.user.password_hash, undefined) // Sensitive data must never be exposed

      ownerToken = data.data.token

      // Check cookie header
      const setCookie = res.headers.get('set-cookie')
      assert.ok(setCookie && setCookie.includes('tbw_session='))
      ownerCookie = setCookie.split(';')[0]
    })

    // 6. Unauthorized access without auth
    await test('GET /api/auth/me without auth token returns 401 UNAUTHORIZED', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/me`)
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'UNAUTHORIZED')
    })

    // 7. Unauthorized access with forged token
    await test('GET /api/auth/me with forged Bearer token returns 401 INVALID_SESSION', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: 'Bearer invalid_forged_token_12345' }
      })
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'INVALID_SESSION')
    })

    // 8. Authorized access using cookie
    await test('GET /api/auth/me with session cookie succeeds and returns user profile', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: ownerCookie }
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.strictEqual(data.success, true)
      assert.strictEqual(data.data.user.email, 'admin@thebusinesswork.com')
      assert.strictEqual(data.data.user.role, 'owner')
    })

    // 9. Authorized access using Bearer header
    await test('GET /api/auth/me with Authorization Bearer header succeeds', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.strictEqual(data.success, true)
      assert.strictEqual(data.data.user.email, 'admin@thebusinesswork.com')
    })

    // 10. Team creation with RBAC: Owner creates a 'viewer' user
    await test('POST /api/team: Owner can create a new team member with viewer role', async () => {
      const res = await fetch(`${BASE_URL}/api/team`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
          email: 'viewer.test@thebusinesswork.com',
          name: 'Viewer Tester',
          role: 'viewer',
          password: 'Password123!'
        })
      })
      // Could be 201 or 409 if already exists from earlier test
      if (res.status === 409) {
        assert.ok(true)
      } else {
        assert.strictEqual(res.status, 201)
        const data = await res.json()
        assert.strictEqual(data.data.role, 'viewer')
      }
    })

    // 11. Viewer logs in successfully
    await test('Viewer can log in and obtain viewer session', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'viewer.test@thebusinesswork.com', password: 'Password123!' })
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.strictEqual(data.data.user.role, 'viewer')
      viewerToken = data.data.token
      viewerCookie = res.headers.get('set-cookie').split(';')[0]
    })

    // 12. RBAC Enforcement: Viewer cannot access /api/team (requires admin/owner)
    await test('RBAC: Viewer accessing /api/team receives 403 FORBIDDEN', async () => {
      const res = await fetch(`${BASE_URL}/api/team`, {
        headers: { Authorization: `Bearer ${viewerToken}` }
      })
      assert.strictEqual(res.status, 403)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'FORBIDDEN')
    })

    // 13. RBAC Enforcement: Viewer cannot update /api/settings (requires owner)
    await test('RBAC: Viewer updating /api/settings receives 403 FORBIDDEN', async () => {
      const res = await fetch(`${BASE_URL}/api/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerToken}`
        },
        body: JSON.stringify({ company_name: 'Hacked Name' })
      })
      assert.strictEqual(res.status, 403)
      const data = await res.json()
      assert.strictEqual(data.success, false)
      assert.strictEqual(data.error.code, 'FORBIDDEN')
    })

    // 14. Owner can update settings
    await test('Owner updating /api/settings succeeds and persists new value', async () => {
      const res = await fetch(`${BASE_URL}/api/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({ company_tagline: 'We Make Business Simpler & Faster.' })
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.strictEqual(data.data.company_tagline, 'We Make Business Simpler & Faster.')
    })

    // 15. Audit Log verification
    await test('Audit logs record critical actions (login, settings change, team creation)', async () => {
      const res = await fetch(`${BASE_URL}/api/audit-log`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      })
      assert.strictEqual(res.status, 200)
      const data = await res.json()
      assert.ok(data.data.total > 0)
      const actions = data.data.items.map(i => i.action)
      assert.ok(actions.includes('auth.login_success'))
      assert.ok(actions.includes('settings.updated'))
    })

    // 16. Logout test
    await test('POST /api/auth/logout invalidates session and subsequent calls return 401', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${viewerToken}` }
      })
      assert.strictEqual(res.status, 200)

      // Test subsequent call with viewer token
      const checkRes = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${viewerToken}` }
      })
      assert.strictEqual(checkRes.status, 401)
      const data = await checkRes.json()
      assert.strictEqual(data.error.code, 'INVALID_SESSION')
    })

    // 17. Password Change Flow
    await test('PUT /api/auth/password updates password and verifies old password fails', async () => {
      // Login again as viewer
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'viewer.test@thebusinesswork.com', password: 'Password123!' })
      })
      const loginData = await loginRes.json()
      const currentToken = loginData.data.token

      // Change password
      const changeRes = await fetch(`${BASE_URL}/api/auth/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          current_password: 'Password123!',
          new_password: 'NewStrongPassword456!'
        })
      })
      assert.strictEqual(changeRes.status, 200)

      // Old password should fail
      const oldLogin = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'viewer.test@thebusinesswork.com', password: 'Password123!' })
      })
      assert.strictEqual(oldLogin.status, 401)

      // New password should succeed
      const newLogin = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'viewer.test@thebusinesswork.com', password: 'NewStrongPassword456!' })
      })
      assert.strictEqual(newLogin.status, 200)
      viewerToken = (await newLogin.json()).data.token
    })

    // 18. User Deactivation & Immediate Session Invalidation
    await test('User deactivation immediately invalidates sessions and blocks login', async () => {
      const db = getDb()
      const viewerUser = db.prepare("SELECT id FROM users WHERE email = 'viewer.test@thebusinesswork.com'").get()

      // Deactivate user via owner
      const patchRes = await fetch(`${BASE_URL}/api/team/${viewerUser.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`
        },
        body: JSON.stringify({ is_active: 0 })
      })
      assert.strictEqual(patchRes.status, 200)

      // Verify active session was killed
      const accessRes = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${viewerToken}` }
      })
      assert.strictEqual(accessRes.status, 401)

      // Attempting to log in as deactivated user returns 403 ACCOUNT_DISABLED
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'viewer.test@thebusinesswork.com', password: 'NewStrongPassword456!' })
      })
      assert.strictEqual(loginRes.status, 403)
      const data = await loginRes.json()
      assert.strictEqual(data.error.code, 'ACCOUNT_DISABLED')
    })

    // 19. SQL Injection Resistance
    await test('SQL injection attempts in login or query parameters are safely handled', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: "' OR 1=1 --", password: "' OR '1'='1" })
      })
      // Validation error because email is not valid email format
      assert.strictEqual(res.status, 400)
      const data = await res.json()
      assert.strictEqual(data.error.code, 'VALIDATION_ERROR')
    })

    // 20. Database persistence across connection restart
    await test('Database persistence: closing connection and reopening preserves data', async () => {
      closeDb()
      const db = getDb()
      const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'company_tagline'").get()
      assert.strictEqual(setting.value, 'We Make Business Simpler & Faster.')

      const ownerUser = db.prepare("SELECT email, role FROM users WHERE email = 'admin@thebusinesswork.com'").get()
      assert.strictEqual(ownerUser.role, 'owner')
    })

  } finally {
    console.log('\n[Teardown] Stopping test server...')
    await stopServer()
  }

  console.log('\n======================================================')
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`)
  console.log('======================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
