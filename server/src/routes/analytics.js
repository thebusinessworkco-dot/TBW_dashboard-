import { Router } from 'express'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'

const router = Router()

/**
 * Builds SQL date condition for given range/dates
 */
function getDateCondition(range = '30d', fromDate, toDate, column = 'created_at') {
  if (fromDate && toDate) {
    return {
      sql: `${column} >= ? AND ${column} <= ?`,
      params: [fromDate, `${toDate} 23:59:59`]
    }
  }

  switch (range) {
    case 'today':
      return {
        sql: `${column} >= datetime('now', 'start of day')`,
        params: []
      }
    case '7d':
      return {
        sql: `${column} >= datetime('now', '-7 days')`,
        params: []
      }
    case '30d':
      return {
        sql: `${column} >= datetime('now', '-30 days')`,
        params: []
      }
    case '90d':
      return {
        sql: `${column} >= datetime('now', '-90 days')`,
        params: []
      }
    case 'all':
      return {
        sql: '1=1',
        params: []
      }
    default:
      return {
        sql: `${column} >= datetime('now', '-30 days')`,
        params: []
      }
  }
}

// GET /api/analytics/dashboard - Comprehensive backend-driven analytics
router.get('/dashboard', requireAuth, (req, res, next) => {
  try {
    const db = getDb()
    const { range = '30d', from, to } = req.query

    const clientFilter = getDateCondition(range, from, to, 'created_at')
    const invFilter = getDateCondition(range, from, to, 'created_at')
    const payFilter = getDateCondition(range, from, to, 'payment_date')
    const expFilter = getDateCondition(range, from, to, 'expense_date')
    const quoteFilter = getDateCondition(range, from, to, 'created_at')
    const msgFilter = getDateCondition(range, from, to, 'created_at')
    const apptFilter = getDateCondition(range, from, to, 'created_at')

    // 1. Leads & CRM Conversion
    const leadStats = db.prepare(`
      SELECT
        COUNT(*) as total_leads,
        SUM(CASE WHEN lifecycle_status IN ('qualified', 'proposal_sent', 'negotiation', 'won') THEN 1 ELSE 0 END) as qualified_leads,
        SUM(CASE WHEN lifecycle_status = 'won' THEN 1 ELSE 0 END) as converted_clients,
        SUM(CASE WHEN lifecycle_status = 'lost' THEN 1 ELSE 0 END) as lost_leads
      FROM clients
      WHERE ${clientFilter.sql}
    `).get(...clientFilter.params)

    const totalLeads = Number(leadStats.total_leads) || 0
    const qualifiedLeads = Number(leadStats.qualified_leads) || 0
    const convertedClients = Number(leadStats.converted_clients) || 0
    const conversionRate = totalLeads > 0 ? Math.round((convertedClients / totalLeads) * 100) : 0

    const leadsByStage = db.prepare(`
      SELECT lifecycle_status as stage, COUNT(*) as count
      FROM clients
      WHERE ${clientFilter.sql}
      GROUP BY lifecycle_status
    `).all(...clientFilter.params)

    const leadsBySource = db.prepare(`
      SELECT COALESCE(lead_source, 'Direct') as source, COUNT(*) as count
      FROM clients
      WHERE ${clientFilter.sql}
      GROUP BY source
      ORDER BY count DESC
      LIMIT 8
    `).all(...clientFilter.params)

    // 2. WhatsApp & AI vs Human Conversations
    const convStats = db.prepare(`
      SELECT
        COUNT(*) as total_conversations,
        SUM(CASE WHEN unread_count > 0 THEN 1 ELSE 0 END) as unread_conversations,
        SUM(CASE WHEN mode = 'ai' THEN 1 ELSE 0 END) as ai_conversations,
        SUM(CASE WHEN mode = 'human' THEN 1 ELSE 0 END) as human_conversations
      FROM conversations
    `).get()

    const newConvs = db.prepare(`
      SELECT COUNT(*) as count FROM conversations WHERE ${clientFilter.sql}
    `).get(...clientFilter.params).count

    const msgStats = db.prepare(`
      SELECT
        COUNT(*) as total_messages,
        SUM(CASE WHEN sender_type = 'ai' THEN 1 ELSE 0 END) as ai_messages,
        SUM(CASE WHEN sender_type = 'employee' THEN 1 ELSE 0 END) as human_messages,
        SUM(CASE WHEN sender_type = 'customer' THEN 1 ELSE 0 END) as client_messages
      FROM messages
      WHERE ${msgFilter.sql}
    `).get(...msgFilter.params)

    let avgResponseTimeMs = 0
    try {
      const respTime = db.prepare(`
        SELECT AVG((julianday(m2.created_at) - julianday(m1.created_at)) * 86400 * 1000) as avg_ms
        FROM messages m1
        JOIN messages m2 ON m2.conversation_id = m1.conversation_id AND m2.id = (
          SELECT MIN(id) FROM messages WHERE conversation_id = m1.conversation_id AND id > m1.id AND sender_type IN ('ai', 'employee')
        )
        WHERE m1.sender_type = 'customer'
      `).get()
      if (respTime?.avg_ms && respTime.avg_ms > 0) {
        avgResponseTimeMs = Math.round(Number(respTime.avg_ms))
      }
    } catch {
      avgResponseTimeMs = 0
    }
    const avgResponseTimeSec = Math.round(avgResponseTimeMs / 1000)

    // 3. Quotation Analytics
    const quoteStats = db.prepare(`
      SELECT
        COUNT(*) as total_quotes,
        SUM(CASE WHEN status IN ('sent', 'viewed', 'accepted', 'rejected') THEN 1 ELSE 0 END) as sent_quotes,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted_quotes,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_quotes,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_quotes
      FROM quotations
      WHERE ${quoteFilter.sql}
    `).get(...quoteFilter.params)

    const totalQuotes = Number(quoteStats.total_quotes) || 0
    const sentQuotes = Number(quoteStats.sent_quotes) || 0
    const acceptedQuotes = Number(quoteStats.accepted_quotes) || 0
    const rejectedQuotes = Number(quoteStats.rejected_quotes) || 0
    const quoteAcceptanceRate = sentQuotes > 0 ? Math.round((acceptedQuotes / sentQuotes) * 100) : 0

    // 4. Financial Analytics & Margins
    const invStats = db.prepare(`
      SELECT
        COALESCE(SUM(total), 0) as total_invoiced,
        COALESCE(SUM(balance_due), 0) as total_outstanding,
        COUNT(*) as invoice_count
      FROM invoices
      WHERE status != 'cancelled' AND ${invFilter.sql}
    `).get(...invFilter.params)

    const payStats = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as total_collected,
        COUNT(*) as payment_count
      FROM payments
      WHERE status = 'confirmed' AND ${payFilter.sql}
    `).get(...payFilter.params)

    const expStats = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as total_expenses,
        COUNT(*) as expense_count
      FROM expenses
      WHERE ${expFilter.sql}
    `).get(...expFilter.params)

    const subStats = db.prepare(`
      SELECT
        COALESCE(SUM(monthly_fee), 0) as mrr,
        COUNT(*) as active_subscriptions
      FROM subscriptions
      WHERE status = 'active'
    `).get()

    const totalInvoiced = Number(invStats.total_invoiced) || 0
    const totalCollected = Number(payStats.total_collected) || 0
    const totalOutstanding = Number(invStats.total_outstanding) || 0
    const totalExpenses = Number(expStats.total_expenses) || 0
    const netProfit = totalCollected - totalExpenses
    const profitMargin = totalCollected > 0 ? Math.round((netProfit / totalCollected) * 100) : 0
    const mrr = Number(subStats.mrr) || 0

    // 5. Client-wise Profitability
    const clientProfitability = db.prepare(`
      SELECT
        c.id as client_id,
        c.name as client_name,
        c.business_name,
        COALESCE(SUM(p.amount), 0) as collected,
        COALESCE(SUM(inv.total), 0) as invoiced,
        COALESCE(SUM(inv.balance_due), 0) as balance_due
      FROM clients c
      LEFT JOIN invoices inv ON inv.client_id = c.id AND inv.status != 'cancelled'
      LEFT JOIN payments p ON p.client_id = c.id AND p.status = 'confirmed'
      GROUP BY c.id
      HAVING collected > 0 OR invoiced > 0
      ORDER BY collected DESC
      LIMIT 10
    `).all()

    // 6. Service-wise Profitability
    const serviceProfitability = db.prepare(`
      SELECT
        ii.description as service_name,
        'Automation Solutions' as category,
        COALESCE(SUM(ii.amount), 0) as revenue,
        COUNT(ii.id) as units_sold
      FROM invoice_items ii
      LEFT JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE inv.status != 'cancelled'
      GROUP BY ii.description
      ORDER BY revenue DESC
      LIMIT 10
    `).all()

    // 7. Projects & Tasks
    const projectStats = db.prepare(`
      SELECT
        COUNT(*) as total_projects,
        SUM(CASE WHEN status IN ('planning', 'in_progress', 'review') THEN 1 ELSE 0 END) as active_projects,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_projects
      FROM projects
    `).get()

    const taskStats = db.prepare(`
      SELECT
        COUNT(*) as total_tasks,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed_tasks,
        SUM(CASE WHEN status != 'done' AND due_date IS NOT NULL AND due_date < date('now') THEN 1 ELSE 0 END) as overdue_tasks
      FROM tasks
    `).get()

    // 8. Appointments & Follow-ups
    const apptStats = db.prepare(`
      SELECT
        COUNT(*) as total_appointments,
        SUM(CASE WHEN status = 'scheduled' AND start_time >= datetime('now') THEN 1 ELSE 0 END) as scheduled_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
      FROM appointments
      WHERE ${apptFilter.sql}
    `).get(...apptFilter.params)

    const followupsDue = db.prepare(`
      SELECT COUNT(*) as count
      FROM clients
      WHERE next_followup IS NOT NULL
        AND next_followup <= datetime('now', '+7 days')
        AND lifecycle_status NOT IN ('won', 'lost', 'archived')
    `).get().count

    // 9. n8n Automation Engine Health
    const automationRows = db.prepare(`
      SELECT workflow_name, workflow_id, type, is_active, last_status, last_execution, error_summary
      FROM automation_integrations
      ORDER BY updated_at DESC
    `).all()

    const automationErrors = automationRows.filter(w => w.last_status === 'error')

    // 10. Financial Timeline Chart Data (Daily / Weekly Buckets)
    // Query payments and expenses for timeline charts
    const timelinePayments = db.prepare(`
      SELECT substr(payment_date, 1, 10) as date, SUM(amount) as income
      FROM payments
      WHERE status = 'confirmed' AND ${payFilter.sql}
      GROUP BY date
      ORDER BY date ASC
    `).all(...payFilter.params)

    const timelineExpenses = db.prepare(`
      SELECT substr(expense_date, 1, 10) as date, SUM(amount) as expense
      FROM expenses
      WHERE ${expFilter.sql}
      GROUP BY date
      ORDER BY date ASC
    `).all(...expFilter.params)

    // Merge timeline maps
    const timelineMap = new Map()
    for (const p of timelinePayments) {
      timelineMap.set(p.date, { date: p.date, income: Number(p.income) || 0, expense: 0 })
    }
    for (const e of timelineExpenses) {
      if (!timelineMap.has(e.date)) {
        timelineMap.set(e.date, { date: e.date, income: 0, expense: Number(e.expense) || 0 })
      } else {
        timelineMap.get(e.date).expense = Number(e.expense) || 0
      }
    }
    const timeline = Array.from(timelineMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    res.json({
      success: true,
      data: {
        range,
        leads: {
          total: totalLeads,
          qualified: qualifiedLeads,
          converted: convertedClients,
          conversion_rate: conversionRate,
          by_stage: leadsByStage,
          by_source: leadsBySource
        },
        whatsapp: {
          total_conversations: Number(convStats.total_conversations) || 0,
          new_in_range: newConvs,
          unread: Number(convStats.unread_conversations) || 0,
          ai_handled: Number(convStats.ai_conversations) || 0,
          human_handled: Number(convStats.human_conversations) || 0,
          total_messages: Number(msgStats.total_messages) || 0,
          ai_messages: Number(msgStats.ai_messages) || 0,
          human_messages: Number(msgStats.human_messages) || 0,
          client_messages: Number(msgStats.client_messages) || 0,
          avg_response_time_ms: avgResponseTimeMs,
          avg_response_time_sec: avgResponseTimeSec
        },
        quotations: {
          total: totalQuotes,
          sent: sentQuotes,
          accepted: acceptedQuotes,
          rejected: rejectedQuotes,
          acceptance_rate: quoteAcceptanceRate
        },
        finance: {
          total_invoiced: totalInvoiced,
          total_collected: totalCollected,
          total_outstanding: totalOutstanding,
          total_expenses: totalExpenses,
          net_profit: netProfit,
          profit_margin: profitMargin,
          mrr: mrr,
          active_subscriptions: subStats.active_subscriptions || 0,
          timeline
        },
        profitability: {
          clients: clientProfitability,
          services: serviceProfitability
        },
        projects: {
          total: Number(projectStats.total_projects) || 0,
          active: Number(projectStats.active_projects) || 0,
          completed: Number(projectStats.completed_projects) || 0,
          total_tasks: Number(taskStats.total_tasks) || 0,
          completed_tasks: Number(taskStats.completed_tasks) || 0,
          overdue_tasks: Number(taskStats.overdue_tasks) || 0
        },
        appointments: {
          total: Number(apptStats.total_appointments) || 0,
          scheduled: Number(apptStats.scheduled_count) || 0,
          completed: Number(apptStats.completed_count) || 0,
          followups_due: followupsDue
        },
        automation: {
          healthy: automationErrors.length === 0,
          total_workflows: automationRows.length,
          active_workflows: automationRows.filter(w => w.is_active).length,
          recent_errors_count: automationErrors.length,
          workflows: automationRows
        }
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
