import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const createQuickReplySchema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
  folder: z.string().default('General'),
  content: z.string().min(1, 'Content is required').max(2000),
  language: z.string().default('English')
})

// GET /api/quick-replies - List all quick replies
router.get('/', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), (req, res, next) => {
  try {
    const db = getDb()

    // Ensure standard default templates exist
    const count = db.prepare('SELECT COUNT(*) as c FROM quick_replies').get().c
    if (count === 0) {
      const defaults = [
        ['Greeting', 'Standard Welcome', 'Hello! Thank you for reaching out to The Business Work. How can our team assist your business today?', 'English'],
        ['Services', 'AI Agents Overview', 'We build custom AI Sales & Customer Support Agents, WhatsApp Automation, and CRM workflows that automate your manual operations. Would you like to see a quick demo?', 'English'],
        ['Consultation', 'Schedule a Strategy Call', 'You can schedule a free 20-minute automation consultation directly with our team here: https://thebusinesswork.com/book', 'English'],
        ['Pricing', 'Quotation Notice', 'Our packages start from ₹15,000 for standard workflow automations and ₹35,000/mo for full AI sales bots. Let me prepare a customized proposal for your requirements.', 'English'],
        ['Payment', 'UPI Payment Details', 'You can make the payment via UPI to: payment@thebusinesswork or request our bank transfer details.', 'English']
      ]
      const insert = db.prepare('INSERT INTO quick_replies (folder, title, content, language) VALUES (?, ?, ?, ?)')
      for (const d of defaults) {
        insert.run(d[0], d[1], d[2], d[3])
      }
    }

    const replies = db.prepare(`
      SELECT id, folder, title, content, language, created_at
      FROM quick_replies
      ORDER BY folder ASC, title ASC
    `).all()

    res.json({
      success: true,
      data: replies
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/quick-replies - Create a new quick reply
router.post('/', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), validate({ body: createQuickReplySchema }), (req, res, next) => {
  try {
    const { folder, title, content, language } = req.body
    const db = getDb()

    const result = db.prepare(`
      INSERT INTO quick_replies (folder, title, content, language, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(folder, title, content, language, req.user.id)

    res.status(201).json({
      success: true,
      data: {
        id: result.lastInsertRowid,
        folder,
        title,
        content,
        language
      }
    })
  } catch (err) {
    next(err)
  }
})

// PUT /api/quick-replies/:id - Update a quick reply
router.put('/:id', requireAuth, requireRole('support', 'sales', 'admin', 'owner'), validate({ body: createQuickReplySchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { folder, title, content, language } = req.body
    const db = getDb()

    const result = db.prepare(`
      UPDATE quick_replies
      SET folder = ?, title = ?, content = ?, language = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(folder, title, content, language, id)

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found.' } })
    }

    res.json({ success: true, message: 'Template updated.' })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/quick-replies/:id - Delete a quick reply
router.delete('/:id', requireAuth, requireRole('admin', 'owner'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    const result = db.prepare('DELETE FROM quick_replies WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found.' } })
    }

    res.json({ success: true, message: 'Template deleted.' })
  } catch (err) {
    next(err)
  }
})

export default router
