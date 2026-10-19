#!/usr/bin/env node
/**
 * THE BUSINESS WORK (DASHBOARD v14)
 * Production SQLite -> Supabase PostgreSQL Data Migration & Verification Tool
 * 
 * Features:
 * - Atomic transaction across all tables: entire migration commits or rolls back together.
 * - Never executes DDL/schemas: assumes verified schema is already installed.
 * - Imports only actual SQLite records with zero dummy data.
 * - Pre-flight checks: SQLite integrity, foreign keys, destination tables, column compatibility.
 * - Converts booleans (0/1 -> true/false), JSON/JSONB, and preserves exact IDs and timestamps.
 * - Safely resets PostgreSQL identity/serial sequences.
 * - Maps real Owner user (ID 1) to Supabase UID: 0384f5a7-a525-4b6e-9517-200bc5ec11e4.
 * - Supports --dry-run, --verify-only, and live migration with credential masking.
 *
 * Usage:
 *   node database/migrate_data.js [--dry-run] [--verify-only] [path_to_sqlite.db]
 */

import pg from 'pg'
import { readdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load better-sqlite3 cleanly in ESM
let Database
try {
  Database = (await import('better-sqlite3')).default
} catch {
  try {
    Database = (await import('../server/node_modules/better-sqlite3/lib/index.js')).default
  } catch {
    const { createRequire } = await import('module')
    const require = createRequire(import.meta.url)
    Database = require(resolve(__dirname, '../server/node_modules/better-sqlite3'))
  }
}

// Strict dependency migration order preserving foreign keys
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
  'projects',
  'tasks',
  'invoices',
  'invoice_items',
  'payments',
  'subscriptions',
  'expenses',
  'appointments',
  'notifications',
  'automation_integrations',
  'audit_logs',
  '_migrations'
]

// Known boolean columns in target PostgreSQL schema
const KNOWN_BOOLEAN_COLUMNS = {
  users: ['is_active'],
  services: ['is_recurring', 'is_active'],
  packages: ['is_active'],
  clients: ['is_deleted'],
  expenses: ['is_recurring'],
  notifications: ['is_read'],
  automation_integrations: ['is_active'],
  google_sheet_config: ['auto_sync_enabled']
}

function maskConnectionString(url) {
  if (!url) return 'NONE'
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@')
}

function findLatestBackup() {
  const candidates = [
    resolve(__dirname, '../server/data/backups'),
    resolve(__dirname, '../server/data')
  ]

  for (const dir of candidates) {
    if (existsSync(dir)) {
      const files = readdirSync(dir)
        .filter(f => (f.startsWith('tbw_backup_') || f === 'tbw.db') && f.endsWith('.db'))
        .sort()
        .reverse()
      if (files.length > 0) {
        return resolve(dir, files[0])
      }
    }
  }
  return null
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

  console.log('\n===============================================================')
  console.log(' THE BUSINESS WORK - PRODUCTION SQLITE -> POSTGRES MIGRATION')
  console.log('===============================================================')
  console.log(`Source SQLite:   ${sqlitePath}`)
  console.log(`Target Postgres: ${maskConnectionString(databaseUrl)}`)
  console.log(`Mode:            ${isVerifyOnly ? 'VERIFY-ONLY (No writes)' : isDryRun ? 'DRY-RUN (Simulated transaction, auto-rollback)' : 'LIVE PRODUCTION MIGRATION'}`)
  console.log('---------------------------------------------------------------\n')

  // --------------------------------------------------------------------------
  // STEP 1: PRE-FLIGHT SOURCE SQLITE INTEGRITY & AUDIT
  // --------------------------------------------------------------------------
  console.log('Step 1: Auditing source SQLite database...')
  const sqlite = new Database(sqlitePath, { readonly: true })

  const integrityCheck = sqlite.pragma('integrity_check')
  if (!integrityCheck || integrityCheck[0]?.integrity_check !== 'ok') {
    throw new Error(`Source SQLite integrity check failed: ${JSON.stringify(integrityCheck)}`)
  }
  console.log('  ✓ SQLite PRAGMA integrity_check: ok')

  const fkViolations = sqlite.pragma('foreign_key_check')
  if (fkViolations.length > 0) {
    throw new Error(`Source SQLite has ${fkViolations.length} foreign key violations! Refusing to migrate corrupted data.`)
  }
  console.log('  ✓ SQLite PRAGMA foreign_key_check: 0 violations')

  // --------------------------------------------------------------------------
  // STEP 2: CONNECT TO POSTGRESQL
  // --------------------------------------------------------------------------
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
    // ------------------------------------------------------------------------
    // STEP 3: DESTINATION SCHEMA & COLUMN COMPATIBILITY PRE-FLIGHT
    // (Never run DDL scripts — verify existing installed schema)
    // ------------------------------------------------------------------------
    console.log('Step 3: Checking destination schema & table compatibility...')

    const existingTablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `)
    const pgTableSet = new Set(existingTablesRes.rows.map(r => r.table_name))

    // Ensure core tables exist in PostgreSQL
    const requiredTables = ['users', 'clients', 'invoices', 'quotations', 'conversations', 'messages']
    for (const reqTable of requiredTables) {
      if (!pgTableSet.has(reqTable)) {
        throw new Error(`Target PostgreSQL table "public.${reqTable}" does not exist! Please apply the verified schema in Supabase first.`)
      }
    }
    console.log('  ✓ Required destination business tables are present in PostgreSQL.')

    // Retrieve column metadata from PostgreSQL for type conversions
    const colMetadataRes = await client.query(`
      SELECT table_name, column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `)
    const pgColumnTypes = new Map() // "table.column" -> data_type
    for (const col of colMetadataRes.rows) {
      pgColumnTypes.set(`${col.table_name}.${col.column_name}`, col.data_type.toLowerCase())
    }

    // Check tbw_cloud schema exists for auth links
    const tbwCloudRes = await client.query(`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tbw_cloud'
    `)
    if (tbwCloudRes.rows.length === 0) {
      throw new Error('Target schema "tbw_cloud" does not exist! Run the verified schema to initialize auth link storage.')
    }
    console.log('  ✓ Target schema "tbw_cloud" verified.')

    // ------------------------------------------------------------------------
    // STEP 4: ATOMIC DATA MIGRATION IN A SINGLE TRANSACTION
    // ------------------------------------------------------------------------
    const summary = []

    if (!isVerifyOnly) {
      console.log('Step 4: Executing atomic data migration in transaction...')
      await client.query('BEGIN')

      try {
        for (const table of TABLE_MIGRATION_ORDER) {
          // Check if table exists in SQLite
          const sqliteTable = sqlite.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
          ).get(table)

          if (!sqliteTable) {
            continue
          }

          // Check if destination table exists in PostgreSQL
          if (!pgTableSet.has(table)) {
            console.log(`  ⚠ Skipping "${table}": table does not exist in target PostgreSQL.`)
            continue
          }

          const countRow = sqlite.prepare(`SELECT count(*) as c FROM "${table}"`).get()
          const rowCount = countRow ? countRow.c : 0

          if (rowCount === 0) {
            summary.push({ table, sqliteRows: 0, pgRows: 0, status: 'EMPTY' })
            continue
          }

          const sqliteRows = sqlite.prepare(`SELECT * FROM "${table}"`).all()
          const sqliteColsInfo = sqlite.prepare(`PRAGMA table_info("${table}")`).all()
          const sqliteColNames = sqliteColsInfo.map(c => c.name)

          // Filter only columns that actually exist in the target PostgreSQL table
          const validColumns = sqliteColNames.filter(col => pgColumnTypes.has(`${table}.${col}`))

          if (validColumns.length === 0) {
            console.log(`  ⚠ Skipping "${table}": no compatible columns found.`)
            continue
          }

          const pkCols = sqliteColsInfo
            .filter(c => c.pk > 0 && validColumns.includes(c.name))
            .map(c => c.name)

          const boolCols = KNOWN_BOOLEAN_COLUMNS[table] || []

          for (const row of sqliteRows) {
            const rowValues = validColumns.map(col => {
              let val = row[col]
              const pgType = pgColumnTypes.get(`${table}.${col}`) || ''

              // Convert SQLite 0/1 booleans
              if (pgType === 'boolean' || boolCols.includes(col)) {
                if (val === null || val === undefined) return null
                return val === 1 || val === true || val === '1'
              }

              // Handle JSON / JSONB columns
              if (pgType === 'json' || pgType === 'jsonb') {
                if (val === null || val === undefined) return null
                if (typeof val === 'object') return JSON.stringify(val)
                return val
              }

              return val
            })

            const placeholders = validColumns.map((_, i) => `$${i + 1}`).join(', ')
            const colNamesSql = validColumns.map(c => `"${c}"`).join(', ')

            // Idempotent conflict resolution
            let conflictClause = 'ON CONFLICT DO NOTHING'
            if (pkCols.length > 0) {
              const pkList = pkCols.map(c => `"${c}"`).join(', ')
              const nonPkCols = validColumns.filter(c => !pkCols.includes(c))
              if (nonPkCols.length > 0) {
                const updateSet = nonPkCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ')
                conflictClause = `ON CONFLICT (${pkList}) DO UPDATE SET ${updateSet}`
              } else {
                conflictClause = `ON CONFLICT (${pkList}) DO NOTHING`
              }
            }

            const insertSql = `
              INSERT INTO public."${table}" (${colNamesSql})
              VALUES (${placeholders})
              ${conflictClause}
            `

            await client.query(insertSql, rowValues)
          }

          // Reset identity / serial sequences safely
          if (validColumns.includes('id')) {
            try {
              const seqRes = await client.query(`
                SELECT pg_get_serial_sequence('public."' || $1 || '"', 'id') AS seq
              `, [table])
              const seqName = seqRes.rows[0]?.seq
              if (seqName) {
                await client.query(`
                  SELECT setval($1, COALESCE((SELECT MAX(id) FROM public."${table}"), 1), true)
                `, [seqName])
              }
            } catch {
              // Ignore if no sequence attached
            }
          }

          console.log(`  ✓ Migrated "${table}": ${rowCount} records.`)
          summary.push({ table, sqliteRows: rowCount, status: isDryRun ? 'DRY_RUN' : 'MIGRATED' })
        }

        // --------------------------------------------------------------------
        // STEP 5: OWNER AUTH LINK MAPPING & ROLE VERIFICATION
        // (Create mapping for verified Owner UID to legacy user ID 1)
        // --------------------------------------------------------------------
        console.log('Step 5: Verifying real owner user and creating Supabase Auth link...')
        const ownerUserRes = await client.query(`
          SELECT id, email, role, is_active
          FROM public.users
          WHERE id = 1
        `)

        if (ownerUserRes.rows.length === 0) {
          throw new Error('Owner user (id: 1) was not found in migrated public.users table! Cannot establish owner auth mapping.')
        }

        const ownerUser = ownerUserRes.rows[0]
        if (ownerUser.role !== 'owner') {
          console.warn(`  ⚠ Warning: User id 1 role is "${ownerUser.role}", expected "owner".`)
        }

        const OWNER_SUPABASE_UID = '0384f5a7-a525-4b6e-9517-200bc5ec11e4'
        await client.query(`
          INSERT INTO tbw_cloud.auth_links (supabase_user_id, legacy_user_id)
          VALUES ($1::uuid, 1)
          ON CONFLICT (supabase_user_id) DO UPDATE SET legacy_user_id = 1
        `, [OWNER_SUPABASE_UID])

        console.log(`  ✓ Owner user verified: "${ownerUser.email}" (role: ${ownerUser.role})`)
        console.log(`  ✓ Supabase Auth mapping established: ${OWNER_SUPABASE_UID} -> legacy id 1`)

        // Finalize transaction
        if (isDryRun) {
          await client.query('ROLLBACK')
          console.log('\n  [Dry-run] Rolled back entire transaction safely. Zero records persisted.')
        } else {
          await client.query('COMMIT')
          console.log('\n  ✓ Committed entire transaction atomically to PostgreSQL.')
        }

      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw new Error(`Migration failed and was atomically rolled back! Error: ${err.message}`)
      }
    }

    // ------------------------------------------------------------------------
    // STEP 6: VERIFICATION & SCORECARD
    // ------------------------------------------------------------------------
    console.log('Step 6: Verifying destination row counts and audit integrity...')
    let allMatched = true
    const scorecard = []

    for (const table of TABLE_MIGRATION_ORDER) {
      const sqliteTable = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      ).get(table)

      if (!sqliteTable || !pgTableSet.has(table)) continue

      const sCount = sqlite.prepare(`SELECT count(*) as c FROM "${table}"`).get().c
      const pgRes = await client.query(`SELECT count(*)::int as c FROM public."${table}"`)
      const pCount = pgRes.rows[0].c

      const match = sCount === pCount
      if (!match) allMatched = false

      scorecard.push({
        Table: table,
        SQLite: sCount,
        PostgreSQL: pCount,
        Status: match ? 'MATCH' : 'MISMATCH'
      })
    }

    // Check Owner Auth Link in tbw_cloud
    const verifyLinkRes = await client.query(`
      SELECT link.supabase_user_id, link.legacy_user_id, u.email, u.role
      FROM tbw_cloud.auth_links link
      JOIN public.users u ON link.legacy_user_id = u.id
      WHERE link.supabase_user_id = '0384f5a7-a525-4b6e-9517-200bc5ec11e4'::uuid
    `)
    const ownerLinkOk = verifyLinkRes.rows.length > 0 && verifyLinkRes.rows[0].role === 'owner'

    console.log('\n================ DATA VERIFICATION SCORECARD ================')
    console.table(scorecard)
    console.log('Owner Auth Link Verified:  ', ownerLinkOk ? 'YES' : 'NO')
    if (ownerLinkOk) {
      console.log(`  Owner Account:            ${verifyLinkRes.rows[0].email} (legacy id: ${verifyLinkRes.rows[0].legacy_user_id})`)
    }
    console.log('=============================================================\n')

    if (!allMatched && !isDryRun && !isVerifyOnly) {
      throw new Error('Data verification failed: row counts do not match between SQLite and PostgreSQL!')
    }

    console.log('✓ Migration and verification process completed successfully.')
    return { success: true, scorecard, ownerLinkOk }

  } finally {
    client.release()
    await pool.end()
    sqlite.close()
  }
}

// CLI Execution entrypoint
if (process.argv[1] && process.argv[1].includes('migrate_data')) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n✗ MIGRATION FATAL ERROR:', err.message)
      process.exit(1)
    })
}
