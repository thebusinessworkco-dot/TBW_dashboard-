import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const createNotificationSchema = z.object({
  user_id: z.coerce.number().int().optional().nullable(),
  type: z.string().default('info'),
  title: z.string().min(1, 'Title is required'),
  body: z.string().optional().default(''),
  link: z.string().optional().nullable()
})

// GET /api/notifications - List user's notifications
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const notifications = await query(`
      SELECT * FROM notifications
      WHERE user_id = $1 OR user_id IS NULL
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.user.id])

    const countRes = await query(`
      SELECT COUNT(*)::int as c FROM notifications
      WHERE (user_id = $1 OR user_id IS NULL) AND is_read = FALSE
    `, [req.user.id])

    res.json({
      success: true,
      data: {
        unread_count: countRes.rows[0]?.c || 0,
        items: notifications.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/notifications/:id/read - Mark single notification as read
router.patch('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    await query('UPDATE notifications SET is_read = TRUE WHERE id = $1', [id])
    res.json({ success: true, message: 'Notification marked as read.' })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/notifications/read-all - Mark all as read
router.patch('/read-all', requireAuth, async (req, res, next) => {
  try {
    await query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1 OR user_id IS NULL', [req.user.id])
    res.json({ success: true, message: 'All notifications marked as read.' })
  } catch (err) {
    next(err)
  }
})

// POST /api/notifications - Dispatch notification
router.post('/', requireAuth, validate({ body: createNotificationSchema }), async (req, res, next) => {
  try {
    const { user_id, type, title, body, link } = req.body
    const targetUser = user_id || req.user.id

    const result = await query(`
      INSERT INTO notifications (user_id, type, title, body, link, is_read)
      VALUES ($1, $2, $3, $4, $5, FALSE)
      RETURNING id
    `, [targetUser, type, title, body || '', link || null])

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        user_id: targetUser,
        title,
        is_read: false
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
