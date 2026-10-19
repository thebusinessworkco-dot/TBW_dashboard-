import { getDb } from './connection.js'
import { resolve, dirname } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function createBackup(customDestDir = null) {
  const db = getDb()
  const backupDir = resolve(customDestDir || process.env.BACKUP_DIR || './data/backups')

  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true })
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFileName = `tbw_backup_${timestamp}.db`
  const backupFilePath = resolve(backupDir, backupFileName)

  console.log(`Starting online SQLite backup to: ${backupFilePath}...`)

  // better-sqlite3 online backup API does not block concurrent readers or writers
  await db.backup(backupFilePath, {
    progress({ totalPages, remainingPages }) {
      const percent = Math.round(((totalPages - remainingPages) / totalPages) * 100)
      if (percent % 25 === 0) {
        console.log(`  Progress: ${percent}% (${totalPages - remainingPages}/${totalPages} pages)`)
      }
    }
  })

  console.log(`✓ Backup successfully created: ${backupFilePath}`)
  return backupFilePath
}

if (process.argv[1] && process.argv[1].includes('backup')) {
  createBackup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Backup failed:', err.message)
      process.exit(1)
    })
}
