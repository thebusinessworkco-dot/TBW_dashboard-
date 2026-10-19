import pg from 'pg'
import { requiredEnv, optionalEnv } from './env.js'

let pool = null

export function getPool() {
  if (!pool) {
    const connectionString = requiredEnv('DATABASE_URL')
    const isLocalPg = connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
    
    pool = new pg.Pool({
      connectionString,
      max: parseInt(optionalEnv('PG_POOL_MAX', '1'), 10),
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 20000,
      ssl: isLocalPg ? false : { rejectUnauthorized: optionalEnv('PG_SSL_REJECT_UNAUTHORIZED', 'false') === 'true' }
    })

    pool.on('error', (err) => {
      console.error('Idle PostgreSQL pool error:', err.code || err.message)
    })
  }

  return pool
}

/**
 * Execute parameterized query using pool
 */
export async function query(text, params = []) {
  const p = getPool()
  return p.query(text, params)
}

/**
 * Execute multiple queries in an ACID transaction
 */
export async function withTransaction(callback) {
  const p = getPool()
  const client = await p.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {}
    throw err
  } finally {
    client.release()
  }
}

export async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
