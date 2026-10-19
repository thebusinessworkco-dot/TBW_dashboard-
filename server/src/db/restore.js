import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync, copyFileSync, readFileSync } from 'fs'
import { closeDb } from './connection.js'
import dotenv from 'dotenv'

dotenv.config()

/**
 * Validates SQLite magic header to ensure file is an authentic SQLite database
 */
function validateSqliteFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Backup file does not exist at path: ${filePath}`)
  }
  const buffer = Buffer.alloc(16)
  const fd = readFileSync(filePath)
  const header = fd.subarray(0, 16).toString('utf8')
  if (!header.startsWith('SQLite format 3')) {
    throw new Error(`File at ${filePath} is not a valid SQLite database header`)
  }
}

/**
 * Safely restores an SQLite backup file into the target database location
 */
export async function restoreBackup(backupFilePath, targetDbPath = null) {
  const target = resolve(targetDbPath || process.env.DATABASE_URL || './data/thebusinesswork.db')
  const backup = resolve(backupFilePath)

  console.log(`[Restore] Validating backup source: ${backup}...`)
  validateSqliteFile(backup)

  // 1. Close current connection pool if open
  console.log('[Restore] Closing active database connections...')
  closeDb()

  // 2. Create pre-restore safety copy of existing database if it exists
  if (existsSync(target)) {
    const safetySnapshot = `${target}.pre-restore-${Date.now()}.bak`
    console.log(`[Restore] Creating safety snapshot: ${safetySnapshot}`)
    copyFileSync(target, safetySnapshot)
  }

  // 3. Restore backup file over target
  console.log(`[Restore] Restoring ${backup} -> ${target}...`)
  copyFileSync(backup, target)

  // 4. Verify integrity of the newly restored database
  console.log('[Restore] Running PRAGMA integrity_check on restored database...')
  const testDb = new Database(target)
  const result = testDb.pragma('integrity_check')
  testDb.close()

  if (result.length === 1 && result[0].integrity_check === 'ok') {
    console.log(`✓ Restoration verified successfully. Integrity check: ok`)
    return { success: true, target, backup }
  } else {
    throw new Error(`Restored database failed integrity check: ${JSON.stringify(result)}`)
  }
}

if (process.argv[1] && process.argv[1].includes('restore')) {
  const backupArg = process.argv[2]
  if (!backupArg) {
    console.error('Usage: node restore.js <path-to-backup.db>')
    process.exit(1)
  }

  restoreBackup(backupArg)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Restore failed:', err.message)
      process.exit(1)
    })
}
