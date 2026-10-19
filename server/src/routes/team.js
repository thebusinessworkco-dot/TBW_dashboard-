import { Router } from 'express'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'

const router = Router()

const createUserSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional().default(''),
  role: z.enum(['owner', 'admin', 'sales', 'support', 'accountant', 'viewer']),
  password: z.string().min(8, 'Password must be at least 8 characters')
})

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  role: z.enum(['owner', 'admin', 'sales', 'support', 'accountant', 'viewer']).optional(),
  is_active: z.number().int().min(0).max(1).optional()
})

// GET /api/team - List team members
router.get('/', requireAuth, requireRole('admin', 'owner'), (req, res, next) => {
  try {
    const db = getDb()
    const users = db.prepare(`
      SELECT id, email, name, phone, role, avatar_url, is_active, last_login_at, created_at
      FROM users
      ORDER BY created_at ASC
    `).all()

    res.json({
      success: true,
      data: users
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/team - Create a new team member
router.post('/', requireAuth, requireRole('admin', 'owner'), validate({ body: createUserSchema }), async (req, res, next) => {
  try {
    const { email, name, phone, role, password } = req.body
    const db = getDb()

    // Non-owners cannot create owners or admins
    if (req.user.role !== 'owner' && (role === 'owner' || role === 'admin')) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only workspace owners can create admin or owner accounts.'
        }
      })
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
    if (existing) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'EMAIL_EXISTS',
          message: 'A user with this email address already exists.'
        }
      })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const result = db.prepare(`
      INSERT INTO users (email, password_hash, name, phone, role, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(email, passwordHash, name, phone || '', role)

    const newUserId = result.lastInsertRowid

    logAudit({
      userId: req.user.id,
      action: 'team.user_created',
      entityType: 'user',
      entityId: newUserId,
      details: { email, name, role },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: newUserId,
        email,
        name,
        phone,
        role,
        is_active: 1
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/team/:id - Update team member
router.patch('/:id', requireAuth, requireRole('admin', 'owner'), validate({ body: updateUserSchema }), (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10)
    const { name, phone, role, is_active } = req.body
    const db = getDb()

    const targetUser = db.prepare('SELECT id, email, role, is_active FROM users WHERE id = ?').get(targetId)
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Team member not found.' }
      })
    }

    // Protection: Only owner can modify another owner or admin
    if (req.user.role !== 'owner' && (targetUser.role === 'owner' || targetUser.role === 'admin')) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only workspace owners can modify admin or owner users.' }
      })
    }

    // Prevent deactivating own account
    if (targetId === req.user.id && is_active === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'You cannot deactivate your own account.' }
      })
    }

    const updates = []
    const params = []

    if (name !== undefined) {
      updates.push('name = ?')
      params.push(name)
    }
    if (phone !== undefined) {
      updates.push('phone = ?')
      params.push(phone)
    }
    if (role !== undefined) {
      if (req.user.role !== 'owner' && (role === 'owner' || role === 'admin')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only workspace owners can promote users to admin or owner.' }
        })
      }
      updates.push('role = ?')
      params.push(role)
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?')
      params.push(is_active)
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')")
      params.push(targetId)
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)

      // If user was deactivated, invalidate all their sessions immediately
      if (is_active === 0) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId)
      }

      logAudit({
        userId: req.user.id,
        action: 'team.user_updated',
        entityType: 'user',
        entityId: targetId,
        details: { changes: req.body },
        ipAddress: req.ip
      })
    }

    const updated = db.prepare(`
      SELECT id, email, name, phone, role, avatar_url, is_active, last_login_at, created_at, updated_at
      FROM users WHERE id = ?
    `).get(targetId)

    res.json({
      success: true,
      data: updated
    })
  } catch (err) {
    next(err)
  }
})

export default router
