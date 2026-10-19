import { Router } from 'express'
import { getDb } from '../db/connection.js'
import { sseManager } from '../services/sse.js'
import { extractToken } from '../middleware/auth.js'

const router = Router()

router.get('/events', (req, res) => {
  // EventSource in browser doesn't send custom headers, so support query param ?token=
  let token = extractToken(req)
  if (!token && req.query.token) {
    token = String(req.query.token).trim()
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required for SSE stream.' }
    })
  }

  const db = getDb()
  const record = db.prepare(`
    SELECT s.user_id, s.expires_at, u.is_active
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).get(token)

  if (!record || new Date() > new Date(record.expires_at) || !record.is_active) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_SESSION', message: 'Invalid or expired session.' }
    })
  }

  // Set SSE HTTP response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Prevent Nginx from buffering SSE
  })

  res.write(': connected\n\n')

  sseManager.addClient(res, record.user_id)
})

export default router
