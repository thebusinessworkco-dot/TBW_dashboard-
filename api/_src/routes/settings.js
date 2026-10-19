import { Router } from 'express'
import { z } from 'zod'
import { query, withTransaction } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'

const router = Router()

const updateSettingsSchema = z.record(z.string(), z.string())

// GET /api/settings - Retrieve application settings
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await query('SELECT key, value, updated_at FROM public.app_settings')

    const settings = {}
    for (const row of result.rows) {
      settings[row.key] = row.value
    }

    res.json({
      success: true,
      data: settings
    })
  } catch (err) {
    next(err)
  }
})

// PUT /api/settings - Update settings (Owner only)
router.put('/', requireAuth, requireRole('owner'), validate({ body: updateSettingsSchema }), async (req, res, next) => {
  try {
    const updates = req.body

    await withTransaction(async (client) => {
      for (const [key, val] of Object.entries(updates)) {
        await client.query(`
          INSERT INTO public.app_settings (key, value, updated_at)
          VALUES ($1, $2, now())
          ON CONFLICT(key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = now()
        `, [key, String(val)])
      }
    })

    await logAudit({
      userId: req.user.id,
      action: 'settings.updated',
      entityType: 'app_settings',
      details: updates,
      ipAddress: req.ip
    })

    const result = await query('SELECT key, value FROM public.app_settings')
    const settings = {}
    for (const row of result.rows) {
      settings[row.key] = row.value
    }

    res.json({
      success: true,
      data: settings
    })
  } catch (err) {
    next(err)
  }
})

export default router
