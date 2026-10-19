import { Router } from 'express'
import { getDb } from '../db/connection.js'

const router = Router()

router.get('/', (req, res) => {
  let dbStatus = 'ok'
  let dbLatencyMs = 0

  try {
    const db = getDb()
    const start = performance.now()
    db.prepare('SELECT 1').get()
    dbLatencyMs = Math.round((performance.now() - start) * 100) / 100
  } catch (err) {
    dbStatus = 'error: ' + err.message
  }

  const memoryUsage = process.memoryUsage()
  const memMb = {
    rss: Math.round(memoryUsage.rss / 1024 / 1024 * 10) / 10,
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024 * 10) / 10,
    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024 * 10) / 10
  }

  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    service: 'tbw-api',
    uptime: Math.round(process.uptime()),
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
      mode: 'WAL'
    },
    memory: {
      ...memMb,
      unit: 'MB'
    },
    timestamp: new Date().toISOString()
  })
})

export default router
