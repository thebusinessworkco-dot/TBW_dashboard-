import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const logAutomationSchema = z.object({
  workflow_name: z.string().min(1),
  workflow_id: z.string().optional().nullable(),
  status: z.enum(['success', 'error', 'running']),
  error_summary: z.string().optional().nullable()
})

// GET /api/automation/status - n8n automation monitoring status
router.get('/status', requireAuth, requireRole('admin', 'owner'), (req, res, next) => {
  try {
    const db = getDb()

    // Ensure default workflows exist in table
    const count = db.prepare('SELECT COUNT(*) as c FROM automation_integrations').get().c
    if (count === 0) {
      const defaultFlows = [
        ['WhatsApp AI & Lead Capture Router', 'tbw-wa-router-v1', 'whatsapp', 'success'],
        ['Google Sheets Lead Sync', 'tbw-sheets-sync-v1', 'sheets', 'success'],
        ['Quotation Sign-off Notification', 'tbw-quote-notify-v1', 'notification', 'success']
      ]
      const insert = db.prepare("INSERT INTO automation_integrations (workflow_name, workflow_id, type, last_status, last_execution) VALUES (?, ?, ?, ?, datetime('now'))")
      for (const f of defaultFlows) {
        insert.run(f[0], f[1], f[2], f[3])
      }
    }

    const workflows = db.prepare('SELECT * FROM automation_integrations ORDER BY updated_at DESC').all()

    const recentErrors = db.prepare(`
      SELECT * FROM automation_integrations WHERE last_status = 'error'
    `).all()

    res.json({
      success: true,
      data: {
        healthy: recentErrors.length === 0,
        total_workflows: workflows.length,
        active_workflows: workflows.filter(w => w.is_active).length,
        recent_errors: recentErrors,
        workflows
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/automation/log - Log execution status from n8n
router.post('/log', (req, res, next) => {
  try {
    const key = req.headers['x-n8n-api-key']
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL
    const configuredKey = process.env.N8N_API_KEY

    if (isProduction && !configuredKey) {
      return res.status(500).json({ success: false, error: { code: 'CONFIGURATION_ERROR', message: 'Webhook authentication is not configured on server.' } })
    }

    const expectedKey = configuredKey || (isProduction ? null : 'dev-n8n-key-change-in-production')

    if (!key || !expectedKey || key !== expectedKey) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing X-N8N-API-KEY' } })
    }

    const { workflow_name, workflow_id, status, error_summary } = req.body
    const db = getDb()

    const existing = db.prepare('SELECT id FROM automation_integrations WHERE workflow_name = ?').get(workflow_name)

    if (existing) {
      db.prepare(`
        UPDATE automation_integrations
        SET last_status = ?, last_execution = datetime('now'), error_summary = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(status, error_summary || null, existing.id)
    } else {
      db.prepare(`
        INSERT INTO automation_integrations (workflow_name, workflow_id, last_status, last_execution, error_summary)
        VALUES (?, ?, ?, datetime('now'), ?)
      `).run(workflow_name, workflow_id || null, status, error_summary || null)
    }

    res.json({ success: true, message: 'Automation execution logged.' })
  } catch (err) {
    next(err)
  }
})

export default router
