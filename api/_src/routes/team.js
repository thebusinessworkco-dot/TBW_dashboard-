import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { query } from '../_lib/db.js'
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
  is_active: z.union([z.number().int().min(0).max(1), z.boolean()]).optional()
})

// GET /api/team - List team members
router.get('/', requireAuth, requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT id, email, name, phone, role, avatar_url, is_active, last_login_at, created_at
      FROM public.users
      ORDER BY created_at ASC
    `)

    res.json({
      success: true,
      data: result.rows
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/team - Create a new team member
router.post('/', requireAuth, requireRole('admin', 'owner'), validate({ body: createUserSchema }), async (req, res, next) => {
  try {
    const { email, name, phone, role, password } = req.body

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

    const existingRes = await query('SELECT id FROM public.users WHERE email = $1', [email])
    if (existingRes.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'EMAIL_EXISTS',
          message: 'A user with this email address already exists.'
        }
      })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const insertRes = await query(`
      INSERT INTO public.users (email, password_hash, name, phone, role, is_active)
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING id, email, name, phone, role, is_active, created_at
    `, [email, passwordHash, name, phone || '', role])

    const newUser = insertRes.rows[0]

    await logAudit({
      userId: req.user.id,
      action: 'team.user_created',
      entityType: 'user',
      entityId: newUser.id,
      details: { email, name, role },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        phone: newUser.phone,
        role: newUser.role,
        is_active: 1
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/team/:id - Update team member
router.patch('/:id', requireAuth, requireRole('admin', 'owner'), validate({ body: updateUserSchema }), async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10)
    const { name, phone, role, is_active } = req.body

    const targetRes = await query('SELECT id, email, role, is_active FROM public.users WHERE id = $1', [targetId])
    const targetUser = targetRes.rows[0]

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
    if (targetId === req.user.id && (is_active === 0 || is_active === false)) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'You cannot deactivate your own account.' }
      })
    }

    const updates = []
    const params = []
    let pIdx = 1

    if (name !== undefined) {
      updates.push(`name = $${pIdx++}`)
      params.push(name)
    }
    if (phone !== undefined) {
      updates.push(`phone = $${pIdx++}`)
      params.push(phone)
    }
    if (role !== undefined) {
      if (req.user.role !== 'owner' && (role === 'owner' || role === 'admin')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only workspace owners can promote users to admin or owner.' }
        })
      }
      updates.push(`role = $${pIdx++}`)
      params.push(role)
    }
    if (is_active !== undefined) {
      const boolVal = is_active === 1 || is_active === true || is_active === '1'
      updates.push(`is_active = $${pIdx++}`)
      params.push(boolVal)
    }

    if (updates.length > 0) {
      updates.push('updated_at = now()')
      params.push(targetId)
      await query(`UPDATE public.users SET ${updates.join(', ')} WHERE id = $${pIdx}`, params)

      // If user was deactivated, invalidate all their sessions immediately
      if (is_active === 0 || is_active === false) {
        await query('DELETE FROM public.sessions WHERE user_id = $1', [targetId])
      }

      await logAudit({
        userId: req.user.id,
        action: 'team.user_updated',
        entityType: 'user',
        entityId: targetId,
        details: { changes: req.body },
        ipAddress: req.ip
      })
    }

    const updatedRes = await query(`
      SELECT id, email, name, phone, role, avatar_url, is_active, last_login_at, created_at, updated_at
      FROM public.users WHERE id = $1
    `, [targetId])

    res.json({
      success: true,
      data: updatedRes.rows[0]
    })
  } catch (err) {
    next(err)
  }
})

export default router
