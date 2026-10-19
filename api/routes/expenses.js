import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'

const router = Router()

const createExpenseSchema = z.object({
  category: z.string().min(1, 'Category is required'),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().min(0.01, 'Amount must be greater than zero'),
  expense_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  vendor: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  is_recurring: z.coerce.number().int().default(0)
})

// GET /api/expenses - List business expenses
router.get('/', requireAuth, requireRole('accountant', 'admin', 'owner'), async (req, res, next) => {
  try {
    const { category, from_date, to_date } = req.query
    const conditions = []
    const params = []

    if (category) {
      params.push(category)
      conditions.push(`e.category = $${params.length}`)
    }

    if (from_date) {
      params.push(from_date)
      conditions.push(`e.expense_date >= $${params.length}`)
    }

    if (to_date) {
      params.push(to_date)
      conditions.push(`e.expense_date <= $${params.length}`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const expenses = await query(`
      SELECT e.*, u.name as recorded_by_name
      FROM expenses e
      LEFT JOIN users u ON e.recorded_by = u.id
      ${whereClause}
      ORDER BY e.expense_date DESC, e.id DESC
    `, params)

    const totalAmount = expenses.rows.reduce((sum, e) => sum + Number(e.amount), 0)

    res.json({
      success: true,
      data: {
        total: totalAmount,
        items: expenses.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/expenses - Record business expense
router.post('/', requireAuth, requireRole('accountant', 'admin', 'owner'), validate({ body: createExpenseSchema }), async (req, res, next) => {
  try {
    const data = req.body

    const result = await query(`
      INSERT INTO expenses (
        category, description, amount, currency, expense_date, is_recurring, vendor, reference, recorded_by
      ) VALUES ($1, $2, $3, 'INR', $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      data.category,
      data.description,
      data.amount,
      data.expense_date,
      Boolean(data.is_recurring),
      data.vendor || null,
      data.reference || null,
      req.user.id
    ])

    const expenseId = result.rows[0].id

    logAudit({
      userId: req.user.id,
      action: 'expense.created',
      entityType: 'expense',
      entityId: expenseId,
      details: { category: data.category, amount: data.amount, vendor: data.vendor },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: expenseId,
        ...data
      }
    })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/expenses/:id - Delete an expense record
router.delete('/:id', requireAuth, requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const result = await query('DELETE FROM expenses WHERE id = $1', [id])
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Expense not found.' } })
    }

    res.json({ success: true, message: 'Expense record deleted.' })
  } catch (err) {
    next(err)
  }
})

export default router
