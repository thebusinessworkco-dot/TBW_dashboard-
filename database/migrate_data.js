#!/usr/bin/env node
/**
 * THE BUSINESS WORK (DASHBOARD v14)
 * Idempotent SQLite -> PostgreSQL Migration & Verification Tool
 * 
 * Usage:
 *   node database/migrate_data.js <path_to_verified_sqlite_backup.db> [--dry-run] [--verify-only]
 */

import pg from 'pg'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

let Database
try {
  Database = require('better-sqlite3')
} catch {
  Database = require(resolve(__dirname, '../server/node_modules/better-sqlite3'))
}

// Migration order respecting foreign key constraints
const TABLE_MIGRATION_ORDER = [
  'app_settings',
  'services',
  'packages',
  'users',
  'sessions',
  'clients',
  'client_notes',
  'lead_events',
  'conversations',
  'messages',
  'message_delivery_events',
  'conversation_notes',
  'quick_replies',
  'whatsapp_templates',
  'quotations',
  'quotation_items',
  'invoices',
  'invoice_items',
  'payments',
  'projects',
  'tasks',
  'subscriptions',
  'expenses',
  'appointments',
  'notifications',
  'automation_integrations',
  'audit_logs',
  '_migrations'
]

// Tables with boolean columns in Postgres that are 0/1 in SQLite
const BOOLEAN_COLUMNS = {
  users: ['is_active'],
  services: ['is_recurring', 'is_active'],
  packages: ['is_active'],
  expenses: ['is_recurring'],
  notifications: ['is_read'],
  automation_integrations: ['is_active']
}

function findLatestBackup() {
  const backupDir = resolve(__dirname, '../server/data/backups')
  if (!existsSync(backupDir)) return null
  const files = readdirSync(backupDir)
    .filter(f => f.startsWith('tbw_backup_') && f.endsWith('.db'))
    .sort()
    .reverse()
  return files.length > 0 ? resolve(backupDir, files[0]) : null
}

export async function runMigration(options = {}) {
  const args = process.argv.slice(2)
  const isDryRun = options.dryRun || args.includes('--dry-run')
  const isVerifyOnly = options.verifyOnly || args.includes('--verify-only')
  
  let sqlitePath = options.sqlitePath || args.find(a => !a.startsWith('--'))
  if (!sqlitePath) {
    sqlitePath = findLatestBackup() || resolve(__dirname, '../server/data/tbw.db')
  }

  if (!existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at: ${sqlitePath}`)
  }

  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required for PostgreSQL migration')
  }

  console.log('===============================================================')
  console.log(' THE BUSINESS WORK - SQLITE TO POSTGRESQL MIGRATION & VERIFY')
  console.log('===============================================================')
  console.log(`Source SQLite:   ${sqlitePath}`)
  console.log(`Target Postgres: ${databaseUrl.replace(/:[^:@]+@/, ':***@')}`)
  console.log(`Dry Run:         ${isDryRun ? 'YES (No writes)' : 'NO (Live import)'}`)
  console.log(`Verify Only:     ${isVerifyOnly ? 'YES' : 'NO'}`)
  console.log('---------------------------------------------------------------')

  // 1. Verify source SQLite integrity
  const sqlite = new Database(sqlitePath, { readonly: true })
  console.log('Step 1: Auditing source SQLite snapshot...')
  const integrity = sqlite.pragma('integrity_check')
  if (!integrity || integrity[0]?.integrity_check !== 'ok') {
    throw new Error(`Source SQLite integrity check failed: ${JSON.stringify(integrity)}`)
  }
  const fkChecks = sqlite.pragma('foreign_key_check')
  if (fkChecks.length > 0) {
    throw new Error(`Source SQLite has ${fkChecks.length} foreign key violations! Refusing to migrate.`)
  }
  console.log('  ✓ SQLite PRAGMA integrity_check: ok')
  console.log('  ✓ SQLite PRAGMA foreign_key_check: 0 violations')

  // 2. Connect to PostgreSQL
  console.log('Step 2: Connecting to target PostgreSQL database...')
  const isLocalPg = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: isLocalPg ? false : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED === 'true' },
    max: 2,
    connectionTimeoutMillis: 10000
  })

  const client = await pool.connect()
  console.log('  ✓ Connected to PostgreSQL successfully.')

  try {
    // 3. Ensure schema is applied
    if (!isVerifyOnly) {
      console.log('Step 3: Ensuring PostgreSQL schema and auth links are applied...')
      const schemaSql = readFileSync(resolve(__dirname, '000_full_schema.sql'), 'utf-8')
      if (!isDryRun) {
        await client.query(schemaSql)
        console.log('  ✓ Schema applied successfully.')
      } else {
        console.log('  [Dry-run] Skipped schema execution.')
      }
    }

    // 4. Data Import
    const summary = []
    if (!isVerifyOnly) {
      console.log('Step 4: Migrating tables in dependency order...')

      for (const table of TABLE_MIGRATION_ORDER) {
        // Check if table exists in SQLite
        const sqliteTable = sqlite.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
        ).get(table)

        if (!sqliteTable) {
          continue
        }

        const countRow = sqlite.prepare(`SELECT count(*) as c FROM "${table}"`).get()
        const rowCount = countRow ? countRow.c : 0

        if (rowCount === 0) {
          summary.push({ table, sqliteRows: 0, pgRows: 0, status: 'EMPTY' })
          continue
        }

        const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all()
        const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name)

        if (isDryRun) {
          console.log(`  [Dry-run] Table ${table}: ${rowCount} rows ready to import`)
          summary.push({ table, sqliteRows: rowCount, pgRows: 0, status: 'DRY_RUN' })
          continue
        }

        // Insert rows idempotently into Postgres in a transaction
        await client.query('BEGIN')
        try {
          const boolCols = BOOLEAN_COLUMNS[table] || []

          for (const row of rows) {
            const rowValues = columns.map(col => {
              let val = row[col]
              if (boolCols.includes(col)) {
                return val === 1 || val === true || val === '1'
              }
              return val
            })

            const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
            const colNames = columns.map(c => `"${c}"`).join(', ')
            
            // Check primary key for ON CONFLICT
            const pkCols = sqlite.prepare(`PRAGMA table_info("${table}")`).all().filter(c => c.pk > 0).map(c => c.name)
            let conflictClause = 'ON CONFLICT DO NOTHING'
            if (pkCols.length > 0) {
              const pkList = pkCols.map(c => `"${c}"`).join(', ')
              const nonPkCols = columns.filter(c => !pkCols.includes(c))
              if (nonPkCols.length > 0) {
                const updateSet = nonPkCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ')
                conflictClause = `ON CONFLICT (${pkList}) DO UPDATE SET ${updateSet}`
              } else {
                conflictClause = `ON CONFLICT (${pkList}) DO NOTHING`
              }
            }

            const insertSql = `
              INSERT INTO public."${table}" (${colNames})
              VALUES (${placeholders})
              ${conflictClause}
            `

            await client.query(insertSql, rowValues)
          }

          // Reset sequence for tables with serial id
          if (columns.includes('id')) {
            await client.query(`
              SELECT setval(
                pg_get_serial_sequence('public."${table}"', 'id'),
                COALESCE((SELECT MAX(id) FROM public."${table}"), 1)
              )
            `).catch(() => {
              // Ignore if no sequence attached
            })
          }

          await client.query('COMMIT')
          console.log(`  ✓ Migrated ${table}: ${rowCount} rows`)
        } catch (err) {
          await client.query('ROLLBACK')
          throw new Error(`Failed to migrate table ${table}: ${err.message}`)
        }
      }
    }

    // 5. Verification: Count match & referential integrity
    console.log('Step 5: Verifying row counts and integrity...')
    let allMatched = true
    const verificationResults = []

    for (const table of TABLE_MIGRATION_ORDER) {
      const sqliteTable = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      ).get(table)

      if (!sqliteTable) continue

      const sCount = sqlite.prepare(`SELECT count(*) as c FROM "${table}"`).get().c
      const pgRes = await client.query(`SELECT count(*)::int as c FROM public."${table}"`)
      const pCount = pgRes.rows[0].c

      const match = sCount === pCount
      if (!match) allMatched = false

      verificationResults.push({
        table,
        sqlite: sCount,
        postgres: pCount,
        status: match ? 'MATCH' : 'MISMATCH'
      })
    }

    // Verify Owner Auth Link
    const ownerLinkRes = await client.query(`
      SELECT link.supabase_user_id, link.legacy_user_id, u.email, u.role
      FROM tbw_cloud.auth_links link
      JOIN public.users u ON link.legacy_user_id = u.id
      WHERE link.supabase_user_id = '0384f5a7-a525-4b6e-9517-200bc5ec11e4'::uuid
    `)
    const ownerValid = ownerLinkRes.rows.length > 0 && ownerLinkRes.rows[0].role === 'owner'

    console.log('\n================ DATA VERIFICATION SCORECARD ================')
    console.table(verificationResults)
    console.log('Owner UID Mapping Verified:', ownerValid ? 'YES' : 'NO')
    if (ownerValid) {
      console.log(`  Owner: ${ownerLinkRes.rows[0].email} (legacy id: ${ownerLinkRes.rows[0].legacy_user_id})`)
    }
    console.log('=============================================================\n')

    if (!allMatched && !isDryRun) {
      throw new Error('Data verification failed: row counts do not match between SQLite and Postgres!')
    }

    console.log('✓ Migration and verification completed successfully.')
    return { success: true, verificationResults, ownerValid }
  } finally {
    client.release()
    await pool.end()
    sqlite.close()
  }
}

if (process.argv[1] && process.argv[1].includes('migrate_data')) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n✗ MIGRATION FATAL ERROR:', err.message)
      process.exit(1)
    })
}
