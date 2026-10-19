import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const packageSchema = z.object({
  service_id: z.coerce.number().int(),
  name: z.string().min(2, 'Package name is required'),
  description: z.string().optional().default(''),
  setup_fee: z.coerce.number().min(0).default(0),
  monthly_fee: z.coerce.number().min(0).default(0)
})

// GET /api/services - List service catalog grouped by category
router.get('/', async (req, res, next) => {
  try {
    const services = await query('SELECT * FROM services WHERE is_active = TRUE ORDER BY category ASC, id ASC')
    res.json({ success: true, data: services.rows })
  } catch (err) {
    next(err)
  }
})

// GET /api/services/packages - List packages
router.get('/packages', async (req, res, next) => {
  try {
    const packages = await query(`
      SELECT p.*, s.name as service_name, s.category
      FROM packages p
      JOIN services s ON p.service_id = s.id
      WHERE p.is_active = TRUE
      ORDER BY p.id ASC
    `)
    res.json({ success: true, data: packages.rows })
  } catch (err) {
    next(err)
  }
})

// POST /api/services/packages - Create or customize a package
router.post('/packages', requireAuth, requireRole('admin', 'owner'), validate({ body: packageSchema }), async (req, res, next) => {
  try {
    const data = req.body

    const result = await query(`
      INSERT INTO packages (service_id, name, description, setup_fee, monthly_fee, is_active)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING id
    `, [data.service_id, data.name, data.description || '', data.setup_fee, data.monthly_fee])

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        ...data
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
