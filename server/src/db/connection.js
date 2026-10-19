import Database from 'better-sqlite3'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

let _db = null

export function getDb() {
  if (_db) return _db

  const dbPath = resolve(process.env.DB_PATH || './data/tbw.db')
  const dbDir = dirname(dbPath)

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }

  _db = new Database(dbPath)

  // Enable WAL mode for concurrent reads + single writer
  _db.pragma('journal_mode = WAL')
  // Enable foreign keys
  _db.pragma('foreign_keys = ON')
  // Faster sync (safe with WAL)
  _db.pragma('synchronous = NORMAL')
  // Keep WAL file small
  _db.pragma('wal_autocheckpoint = 1000')
  // Generous cache for 1GB VPS
  _db.pragma('cache_size = -8000') // 8MB

  return _db
}

export function closeDb() {
  if (_db) {
    _db.close()
    _db = null
  }
}
