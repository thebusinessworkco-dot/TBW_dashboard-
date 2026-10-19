import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'

const router = Router()

const updateSettingsSchema = z.record(z.string(), z.string())

// GET /api/settings - Retrieve application settings
router.get('/', requireAuth, (req, res, next) => {
  try {
    const db = getDb()
    const rows = db.prepare('SELECT key, value, updated_at FROM app_settings').all()

    const settings = {}
    for (const row of rows) {
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
router.put('/', requireAuth, requireRole('owner'), validate({ body: updateSettingsSchema }), (req, res, next) => {
  try {
    const db = getDb()
    const updates = req.body

    const upsertStmt = db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `)

    const updateMany = db.transaction((settingsObj) => {
      for (const [key, val] of Object.entries(settingsObj)) {
        upsertStmt.run(key, String(val))
      }
    })

    updateMany(updates)

    logAudit({
      userId: req.user.id,
      action: 'settings.updated',
      entityType: 'app_settings',
      details: updates,
      ipAddress: req.ip
    })

    // Return updated settings
    const rows = db.prepare('SELECT key, value FROM app_settings').all()
    const settings = {}
    for (const row of rows) {
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
