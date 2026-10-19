import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
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
router.get('/', requireAuth, (req, res, next) => {
  try {
    const db = getDb()
    const { status, client_id, assigned_to } = req.query

    const conditions = []
    const params = []

    if (status) {
      conditions.push('p.status = ?')
      params.push(status)
    }

    if (client_id) {
      conditions.push('p.client_id = ?')
      params.push(parseInt(client_id, 10))
    }

    if (assigned_to) {
      conditions.push('p.assigned_to = ?')
      params.push(parseInt(assigned_to, 10))
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const projects = db.prepare(`
      SELECT
        p.*,
        c.name as client_name,
        c.business_name,
        u.name as assigned_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as total_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as completed_tasks
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      LEFT JOIN users u ON p.assigned_to = u.id
      ${whereClause}
      ORDER BY p.created_at DESC
    `).all(...params)

    res.json({
      success: true,
      data: projects
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/projects/:id - Project detail with tasks
router.get('/:id', requireAuth, (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    const project = db.prepare(`
      SELECT
        p.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        u.name as assigned_name
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      LEFT JOIN users u ON p.assigned_to = u.id
      WHERE p.id = ?
    `).get(id)

    if (!project) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found.' } })
    }

    const tasks = db.prepare(`
      SELECT t.*, u.name as assigned_name
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.project_id = ?
      ORDER BY t.sort_order ASC, t.id ASC
    `).all(id)

    res.json({
      success: true,
      data: {
        ...project,
        tasks
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/projects - Create project
router.post('/', requireAuth, requireRole('sales', 'admin', 'owner'), validate({ body: createProjectSchema }), (req, res, next) => {
  try {
    const db = getDb()
    const data = req.body

    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(data.client_id)
    if (!client) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Referenced client does not exist.' } })
    }

    const result = db.prepare(`
      INSERT INTO projects (
        title, client_id, quotation_id, invoice_id, assigned_to,
        status, budget, start_date, due_date, deliverables, notes
      ) VALUES (?, ?, ?, ?, ?, 'planning', ?, ?, ?, ?, ?)
    `).run(
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
    )

    const projectId = result.lastInsertRowid

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
router.patch('/:id/status', requireAuth, validate({ body: updateProjectStatusSchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status } = req.body
    const db = getDb()

    db.prepare("UPDATE projects SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
    res.json({ success: true, data: { id, status } })
  } catch (err) {
    next(err)
  }
})

// GET /api/projects/:id/tasks - List tasks for project
router.get('/:id/tasks', requireAuth, (req, res, next) => {
  try {
    const projectId = parseInt(req.params.id, 10)
    const db = getDb()

    const tasks = db.prepare(`
      SELECT t.*, u.name as assigned_name
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.project_id = ?
      ORDER BY t.sort_order ASC, t.id ASC
    `).all(projectId)

    res.json({ success: true, data: tasks })
  } catch (err) {
    next(err)
  }
})

// POST /api/projects/:id/tasks - Create task under project
router.post('/:id/tasks', requireAuth, validate({ body: createTaskSchema.omit({ project_id: true }) }), (req, res, next) => {
  try {
    const projectId = parseInt(req.params.id, 10)
    const db = getDb()
    const data = req.body

    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!project) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found.' } })
    }

    const result = db.prepare(`
      INSERT INTO tasks (
        project_id, title, description, assigned_to, priority, status, due_date, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      data.title,
      data.description || '',
      data.assigned_to || null,
      data.priority || 'medium',
      data.status || 'todo',
      data.due_date || null,
      data.sort_order || 0
    )

    res.status(201).json({
      success: true,
      data: {
        id: result.lastInsertRowid,
        project_id: projectId,
        ...data
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/projects/tasks/:taskId - Update task
router.patch('/tasks/:taskId', requireAuth, validate({ body: updateTaskSchema }), (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10)
    const db = getDb()
    const data = req.body

    const current = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
    if (!current) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task not found.' } })
    }

    db.prepare(`
      UPDATE tasks SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        assigned_to = COALESCE(?, assigned_to),
        priority = COALESCE(?, priority),
        status = COALESCE(?, status),
        due_date = COALESCE(?, due_date),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      data.title ?? null,
      data.description ?? null,
      data.assigned_to ?? null,
      data.priority ?? null,
      data.status ?? null,
      data.due_date ?? null,
      taskId
    )

    res.json({ success: true, message: 'Task updated.' })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/projects/tasks/:taskId - Delete task
router.delete('/tasks/:taskId', requireAuth, (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10)
    const db = getDb()

    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task not found.' } })
    }

    res.json({ success: true, message: 'Task deleted.' })
  } catch (err) {
    next(err)
  }
})

export default router
