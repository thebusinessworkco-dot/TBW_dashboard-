import pg from 'pg'
import { requiredEnv } from './env.js'

// ONE connection per warm serverless instance; connect via Supabase Transaction pooler.
// The 'pg' driver uses parameterized, unnamed queries by default (not session-prepared SQL).
// Connection is opened lazily at the first database request.
let pool
export function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: requiredEnv('DATABASE_URL'),
      max: 1,
      connectionTimeoutMillis: 8_000,
      idleTimeoutMillis: 20_000,
      // The connection string must come from Supabase's TLS-enabled transaction pooler.
      ssl: { rejectUnauthorized: true },
    })
    pool.on('error', (error) => {
      // Do not print any connection strings, credentials, or SQL parameter values.
      console.error('Idle PostgreSQL connection error:', error.code || 'CONNECTION_ERROR')
    })
  }
  return pool
}
