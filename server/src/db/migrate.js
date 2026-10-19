import { getDb } from './connection.js'
import { readFileSync, readdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function runMigrations() {
  const db = getDb()

  // Ensure migrations tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
  )

  const migrationsDir = resolve(__dirname, 'migrations')
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue

    const sql = readFileSync(resolve(migrationsDir, file), 'utf-8')

    const migrate = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file)
    })

    try {
      migrate()
      console.log(`  ✓ Applied migration: ${file}`)
    } catch (err) {
      console.error(`  ✗ Migration failed: ${file}`)
      console.error(`    ${err.message}`)
      throw err
    }
  }
}

// Run directly if called as a script
if (process.argv[1] && process.argv[1].includes('migrate')) {
  const { config } = await import('dotenv')
  config()
  console.log('Running migrations...')
  runMigrations()
  console.log('Done.')
  process.exit(0)
}
