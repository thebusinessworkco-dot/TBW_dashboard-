import { Router } from 'express'
import { authenticateUser } from '../_lib/auth.js'
import { extractToken } from '../middleware/auth.js'
import { sseManager } from '../services/sse.js'

const router = Router()

router.get('/events', async (req, res) => {
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

  const user = await authenticateUser(token)
  if (!user) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_SESSION', message: 'Invalid or expired session.' }
    })
  }

  // Set SSE HTTP response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })

  res.write(': connected\n\n')
  sseManager.addClient(res, user.id)

  // In serverless environments, inform client and terminate cleanly to prevent 504 timeouts
  res.write(`data: ${JSON.stringify({ type: 'serverless_notice', message: 'Realtime notifications migrated to authenticated polling and Supabase Realtime.' })}\n\n`)
  res.end()
})

export default router
