import { getDb } from './connection.js'
import bcrypt from 'bcrypt'

export async function seedOwner() {
  const db = getDb()

  // Check if any users exist
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get()
  if (count.c > 0) return

  const isProd = process.env.NODE_ENV === 'production'
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@thebusinesswork.com'
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || (isProd ? null : 'admin123')

  if (isProd && !adminPassword) {
    throw new Error(
      'CRITICAL SECURITY CONFIGURATION ERROR: In production, the INITIAL_ADMIN_PASSWORD environment variable must be explicitly configured with a strong password (minimum 12 characters).'
    )
  }

  if (isProd && adminPassword.length < 12) {
    throw new Error(
      'CRITICAL SECURITY ERROR: INITIAL_ADMIN_PASSWORD must be at least 12 characters long in production.'
    )
  }

  const hash = await bcrypt.hash(adminPassword, 12)

  db.prepare(`
    INSERT INTO users (email, password_hash, name, phone, role)
    VALUES (?, ?, ?, ?, 'owner')
  `).run(
    adminEmail,
    hash,
    'Admin',
    '',
  )

  if (isProd) {
    console.log(`  ✓ Created initial owner account: ${adminEmail} (password configured via INITIAL_ADMIN_PASSWORD)`)
  } else {
    console.log(`  ✓ Created initial owner account: ${adminEmail} (dev/test fallback password: ${adminPassword})`)
  }
}

// Run directly
if (process.argv[1] && process.argv[1].includes('seed')) {
  const { config } = await import('dotenv')
  config()
  await seedOwner()
  process.exit(0)
}
