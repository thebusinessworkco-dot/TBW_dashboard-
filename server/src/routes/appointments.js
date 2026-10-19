import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { logAudit } from '../utils/audit.js'

const router = Router()

const createAppointmentSchema = z.object({
  client_id: z.coerce.number().int().optional().nullable(),
  title: z.string().min(2, 'Title is required'),
  description: z.string().optional().default(''),
  type: z.enum(['discovery_call', 'demo', 'proposal_review', 'onboarding', 'support', 'meeting']).default('discovery_call'),
  start_time: z.string().min(10, 'Start time is required'),
  end_time: z.string().min(10, 'End time is required'),
  location: z.string().optional().default('Google Meet / Zoom'),
  meeting_link: z.string().optional().nullable(),
  notes: z.string().optional().default('')
})

const updateStatusSchema = z.object({
  status: z.enum(['scheduled', 'completed', 'cancelled', 'rescheduled', 'no_show'])
})

// GET /api/appointments - List appointments for calendar/schedule
router.get('/', requireAuth, (req, res, next) => {
  try {
    const db = getDb()
    const { client_id, user_id, from_date, to_date } = req.query

    const conditions = []
    const params = []

    if (client_id) {
      conditions.push('a.client_id = ?')
      params.push(parseInt(client_id, 10))
    }

    if (user_id) {
      conditions.push('a.user_id = ?')
      params.push(parseInt(user_id, 10))
    }

    if (from_date) {
      conditions.push('a.start_time >= ?')
      params.push(from_date)
    }

    if (to_date) {
      conditions.push('a.start_time <= ?')
      params.push(to_date)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const appointments = db.prepare(`
      SELECT
        a.*,
        c.name as client_name,
        c.business_name,
        c.whatsapp_phone as client_phone,
        u.name as assigned_name
      FROM appointments a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.start_time ASC
    `).all(...params)

    res.json({
      success: true,
      data: appointments
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/appointments - Schedule new appointment
router.post('/', requireAuth, validate({ body: createAppointmentSchema }), (req, res, next) => {
  try {
    const db = getDb()
    const data = req.body

    const result = db.prepare(`
      INSERT INTO appointments (
        client_id, user_id, title, description, type, start_time, end_time,
        location, meeting_link, notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
    `).run(
      data.client_id || null,
      req.user.id,
      data.title,
      data.description || '',
      data.type,
      data.start_time,
      data.end_time,
      data.location || 'Google Meet',
      data.meeting_link || null,
      data.notes || ''
    )

    const appointmentId = result.lastInsertRowid

    if (data.client_id) {
      db.prepare(`
        INSERT INTO lead_events (client_id, event_type, description, user_id)
        VALUES (?, 'appointment_scheduled', ?, ?)
      `).run(data.client_id, `Appointment scheduled: ${data.title} on ${data.start_time}`, req.user.id)
    }

    logAudit({
      userId: req.user.id,
      action: 'appointment.scheduled',
      entityType: 'appointment',
      entityId: appointmentId,
      details: { title: data.title, start_time: data.start_time },
      ipAddress: req.ip
    })

    res.status(201).json({
      success: true,
      data: {
        id: appointmentId,
        ...data,
        status: 'scheduled'
      }
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/appointments/:id/status - Update appointment status
router.patch('/:id/status', requireAuth, validate({ body: updateStatusSchema }), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status } = req.body
    const db = getDb()

    db.prepare("UPDATE appointments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
    res.json({ success: true, data: { id, status } })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/appointments/:id - Delete appointment
router.delete('/:id', requireAuth, (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()

    const result = db.prepare('DELETE FROM appointments WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Appointment not found.' } })
    }

    res.json({ success: true, message: 'Appointment removed.' })
  } catch (err) {
    next(err)
  }
})

export default router
