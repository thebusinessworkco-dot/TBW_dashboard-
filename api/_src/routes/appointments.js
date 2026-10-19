import { Router } from 'express'
import { z } from 'zod'
import { query } from '../_lib/db.js'
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
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { client_id, user_id, from_date, to_date } = req.query
    const conditions = []
    const params = []

    if (client_id) {
      params.push(parseInt(client_id, 10))
      conditions.push(`a.client_id = $${params.length}`)
    }

    if (user_id) {
      params.push(parseInt(user_id, 10))
      conditions.push(`a.user_id = $${params.length}`)
    }

    if (from_date) {
      params.push(from_date)
      conditions.push(`a.start_time >= $${params.length}`)
    }

    if (to_date) {
      params.push(to_date)
      conditions.push(`a.start_time <= $${params.length}`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const appointments = await query(`
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
    `, params)

    res.json({
      success: true,
      data: appointments.rows
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/appointments - Schedule new appointment
router.post('/', requireAuth, validate({ body: createAppointmentSchema }), async (req, res, next) => {
  try {
    const data = req.body

    const result = await query(`
      INSERT INTO appointments (
        client_id, user_id, title, description, type, start_time, end_time,
        location, meeting_link, notes, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled')
      RETURNING id
    `, [
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
    ])

    const appointmentId = result.rows[0].id

    if (data.client_id) {
      await query(`
        INSERT INTO lead_events (client_id, event_type, description, user_id)
        VALUES ($1, 'appointment_scheduled', $2, $3)
      `, [data.client_id, `Appointment scheduled: ${data.title} on ${data.start_time}`, req.user.id])
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
router.patch('/:id/status', requireAuth, validate({ body: updateStatusSchema }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { status } = req.body

    await query("UPDATE appointments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [status, id])
    res.json({ success: true, data: { id, status } })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/appointments/:id - Delete appointment
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)

    const result = await query('DELETE FROM appointments WHERE id = $1', [id])
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Appointment not found.' } })
    }

    res.json({ success: true, message: 'Appointment removed.' })
  } catch (err) {
    next(err)
  }
})

export default router
