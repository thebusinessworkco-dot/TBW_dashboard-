import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
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
router.get('/', requireAuth, (req, res, next) => {
  try {
    const db = getDb()
    const notifications = db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ? OR user_id IS NULL
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.user.id)

    const unreadCount = db.prepare(`
      SELECT COUNT(*) as c FROM notifications
      WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0
    `).get(req.user.id).c

    res.json({
      success: true,
      data: {
        unread_count: unreadCount,
        items: notifications
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/notifications/:id/read - Mark single notification as read
router.patch('/:id/read', requireAuth, (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id)
    res.json({ success: true, message: 'Notification marked as read.' })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/notifications/read-all - Mark all as read
router.patch('/read-all', requireAuth, (req, res, next) => {
  try {
    const db = getDb()
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? OR user_id IS NULL').run(req.user.id)
    res.json({ success: true, message: 'All notifications marked as read.' })
  } catch (err) {
    next(err)
  }
})

// POST /api/notifications - Dispatch notification
router.post('/', requireAuth, validate({ body: createNotificationSchema }), (req, res, next) => {
  try {
    const db = getDb()
    const { user_id, type, title, body, link } = req.body

    const targetUser = user_id || req.user.id

    const result = db.prepare(`
      INSERT INTO notifications (user_id, type, title, body, link, is_read)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(targetUser, type, title, body || '', link || null)

    res.status(201).json({
      success: true,
      data: {
        id: result.lastInsertRowid,
        user_id: targetUser,
        title,
        is_read: 0
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
