import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'

const router = Router()

const createProjectSchema = z.object({
  title: z.string().min(2, 'Project title is required'),
  client_id: z.coerce.number().int(),
  quotation_id: z.coerce.number().int().optional().nullable(),
  invoice_id: z.coerce.number().int().optional().nullable(),
  assigned_to: z.coerce.number().int().optional().nullable(),
  budget: z.coerce.number().optional().nullable(),
  start_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  due_date: z.string().optional().nullable(),
  deliverables: z.string().optional().default(''),
  notes: z.string().optional().default('')
})

const updateProjectStatusSchema = z.object({
  status: z.enum(['planning', 'development', 'testing', 'client_review', 'delivered', 'maintenance', 'archived'])
})

const createTaskSchema = z.object({
  project_id: z.coerce.number().int(),
  title: z.string().min(1, 'Task title is required'),
  description: z.string().optional().default(''),
  assigned_to: z.coerce.number().int().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  status: z.enum(['todo', 'in_progress', 'review', 'done']).default('todo'),
  due_date: z.string().optional().nullable(),
  sort_order: z.coerce.number().default(0)
})

const updateTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  assigned_to: z.coerce.number().int().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['todo', 'in_progress', 'review', 'done']).optional(),
  due_date: z.string().optional().nullable()
})

// GET /api/projects - List projects with task completion counts
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status, client_id, assigned_to } = req.query
    const conditions = []
    const params = []

    if (status) {
      params.push(status)
      conditions.push(`p.status = $${params.length}`)
    }

    if (client_id) {
      params.push(parseInt(client_id, 10))
      conditions.push(`p.client_id = $${params.length}`)
    }

    if (assigned_to) {
      params.push(parseInt(assigned_to, 10))
      conditions.push(`p.assigned_to = $${params.length}`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const projects = await query(`
      SELECT
        p.*,
        c.name as client_name,
        c.business_name,
        u.name as assigned_name,
        (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id) as total_tasks,
        (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as completed_tasks
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      LEFT JOIN users u ON p.assigned_to = u.id
      ${whereClause}
      ORDER BY p.created_at DESC
    `, params)

    res.json({
      success: true,
      data: projects.rows
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/projects/:id - Project detail with tasks
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const projRes = await query(`
      SELECT
        p.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        u.name as assigned_name
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      LEFT JOIN users u ON p.assigned_to = u.id
      WHERE p.id = $1
    `, [id])

    const project = projRes.rows[0]
    if (!project) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found.' } })
    }

    const tasksRes = await query(`
      SELECT t.*, u.name as assigned_name
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.project_id = $1
      ORDER BY t.sort_order ASC, t.id ASC
    `, [id])

    res.json({
      success: true,
      data: {
        ...project,
        tasks: tasksRes.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/projects - Create project
router.post('/', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: createProjectSchema }), async (req, res, next) => {
  try {
    const data = req.body

    const clientRes = await query('SELECT id FROM clients WHERE id = $1', [data.client_id])
    if (clientRes.rows.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Referenced client does not exist.' } })
    }

    const result = await query(`
      INSERT INTO projects (
        title, client_id, quotation_id, invoice_id, assigned_to,
        status, budget, start_date, due_date, deliverables, notes
      ) VALUES ($1, $2, $3, $4, $5, 'planning', $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      data.title,
      data.client_id,
      data.quotation_id || null,
      data.invoice_id || null,
      data.assigned_to || req.user.id,
      data.budget || null,
      data.start_date,
      data.due_date || null,
      data.deliverables || '',
      data.notes || ''
    ])

    const projectId = result.rows[0].id

    logAudit({
      userId: req.user.id,
      action: 'project.created',
      entityType: 'project',
      entityId: projectId,
      details: { title: data.title, client_id: data.client_id },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: projectId,
        ...data,
        status: 'planning'
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/projects/:id/status - Update project status
router.patch('/:id/status', requireAuth, validate({ body: updateProjectStatusSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status } = req.body

    await query("UPDATE projects SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [status, id])
    res.json({ success: true, data: { id, status } })
  } catch (err) {
    next(err)
  }
})

// GET /api/projects/:id/tasks - List tasks for project
router.get('/:id/tasks', requireAuth, async (req, res, next) => {
  try {
    const projectId = parseInt(req.params.id, 10)

    const tasksRes = await query(`
      SELECT t.*, u.name as assigned_name
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.project_id = $1
      ORDER BY t.sort_order ASC, t.id ASC
    `, [projectId])

    res.json({ success: true, data: tasksRes.rows })
  } catch (err) {
    next(err)
  }
})

// POST /api/projects/:id/tasks - Create task under project
router.post('/:id/tasks', requireAuth, validate({ body: createTaskSchema.omit({ project_id: true }) }), async (req, res, next) => {
  try {
    const projectId = parseInt(req.params.id, 10)
    const data = req.body

    const projRes = await query('SELECT id FROM projects WHERE id = $1', [projectId])
    if (projRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found.' } })
    }

    const result = await query(`
      INSERT INTO tasks (
        project_id, title, description, assigned_to, priority, status, due_date, sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      projectId,
      data.title,
      data.description || '',
      data.assigned_to || null,
      data.priority || 'medium',
      data.status || 'todo',
      data.due_date || null,
      data.sort_order || 0
    ])

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        project_id: projectId,
        ...data
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/projects/tasks/:taskId - Update task
router.patch('/tasks/:taskId', requireAuth, validate({ body: updateTaskSchema }), async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10)
    const data = req.body

    const curRes = await query('SELECT * FROM tasks WHERE id = $1', [taskId])
    if (curRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task not found.' } })
    }

    await query(`
      UPDATE tasks SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        assigned_to = COALESCE($3, assigned_to),
        priority = COALESCE($4, priority),
        status = COALESCE($5, status),
        due_date = COALESCE($6, due_date),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
    `, [
      data.title ?? null,
      data.description ?? null,
      data.assigned_to ?? null,
      data.priority ?? null,
      data.status ?? null,
      data.due_date ?? null,
      taskId
    ])

    res.json({ success: true, message: 'Task updated.' })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/projects/tasks/:taskId - Delete task
router.delete('/tasks/:taskId', requireAuth, async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10)

    const result = await query('DELETE FROM tasks WHERE id = $1', [taskId])
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task not found.' } })
    }

    res.json({ success: true, message: 'Task deleted.' })
  } catch (err) {
    next(err)
  }
})

export default router
