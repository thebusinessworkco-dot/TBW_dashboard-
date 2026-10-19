import { Router } from 'express'
import { query } from '../_lib/db.js'

const router = Router()

router.get('/', async (req, res) => {
  let dbStatus = 'ok'
  let dbTime = null
  let dbError = null

  try {
    const start = Date.now()
    await query('SELECT NOW() as now, 1 as ok')
    dbTime = Date.now() - start
  } catch (err) {
    dbStatus = 'error'
    dbError = err.message
    console.error('Health check DB error:', err.message, err.code)
  }

  const isHealthy = dbStatus === 'ok'

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    status: isHealthy ? 'healthy' : 'degraded',
    service: 'tbw-dashboard-api',
    version: '14.0.0',
    runtime: 'vercel-serverless-nodejs',
    database: {
      driver: 'pg-pool',
      target: 'supabase-postgres',
      status: dbStatus,
      latency_ms: dbTime,
      ...(dbError ? { error: dbError } : {})
    },
    timestamp: new Date().toISOString()
  })
})

export default router
