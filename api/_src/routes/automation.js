import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
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
router.get('/status', requireAuth, requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    // Ensure default workflows exist in table
    const countRes = await query('SELECT COUNT(*)::int as c FROM automation_integrations')
    if (countRes.rows[0]?.c === 0) {
      const defaultFlows = [
        ['WhatsApp AI & Lead Capture Router', 'tbw-wa-router-v1', 'whatsapp', 'success'],
        ['Google Sheets Lead Sync', 'tbw-sheets-sync-v1', 'sheets', 'success'],
        ['Quotation Sign-off Notification', 'tbw-quote-notify-v1', 'notification', 'success']
      ]
      for (const f of defaultFlows) {
        await query(
          'INSERT INTO automation_integrations (workflow_name, workflow_id, type, last_status, last_execution) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
          [f[0], f[1], f[2], f[3]]
        )
      }
    }

    const workflows = await query('SELECT * FROM automation_integrations ORDER BY updated_at DESC')
    const recentErrors = await query("SELECT * FROM automation_integrations WHERE last_status = 'error'")

    res.json({
      success: true,
      data: {
        healthy: recentErrors.rows.length === 0,
        total_workflows: workflows.rows.length,
        active_workflows: workflows.rows.filter(w => w.is_active).length,
        recent_errors: recentErrors.rows,
        workflows: workflows.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/automation/log - Log execution status from n8n
router.post('/log', async (req, res, next) => {
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

    const existingRes = await query('SELECT id FROM automation_integrations WHERE workflow_name = $1', [workflow_name])
    const existing = existingRes.rows[0]

    if (existing) {
      await query(`
        UPDATE automation_integrations
        SET last_status = $1, last_execution = CURRENT_TIMESTAMP, error_summary = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [status, error_summary || null, existing.id])
    } else {
      await query(`
        INSERT INTO automation_integrations (workflow_name, workflow_id, last_status, last_execution, error_summary)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
      `, [workflow_name, workflow_id || null, status, error_summary || null])
    }

    res.json({ success: true, message: 'Automation execution logged.' })
  } catch (err) {
    next(err)
  }
})

export default router
