import { Router } from 'express'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { generateExecutiveReportPdf } from '../services/pdf.js'

const router = Router()

/**
 * Escapes CSV values and wraps in quotes if needed
 */
function toCsvRow(fields) {
  return fields.map(f => {
    if (f === null || f === undefined) return '""'
    const str = String(f).replace(/"/g, '""')
    return `"${str}"`
  }).join(',')
}

// GET /api/reports/export-csv - Export real database entities as structured CSV
router.get('/export-csv', requireAuth, async (req, res, next) => {
  try {
    const { type = 'invoices' } = req.query

    let csvContent = ''
    let filename = `tbw-${type}-${Date.now()}.csv`

    if (type === 'invoices') {
      const invoices = await query(`
        SELECT
          inv.invoice_number,
          c.name as client_name,
          c.business_name,
          inv.status,
          inv.issue_date,
          inv.due_date,
          inv.subtotal,
          inv.tax_amount,
          inv.total,
          inv.amount_paid,
          inv.balance_due,
          inv.currency
        FROM invoices inv
        LEFT JOIN clients c ON inv.client_id = c.id
        ORDER BY inv.id DESC
      `)

      const headers = ['Invoice Number', 'Client Name', 'Business Name', 'Status', 'Issue Date', 'Due Date', 'Subtotal (INR)', 'Tax (INR)', 'Total (INR)', 'Paid (INR)', 'Balance Due (INR)', 'Currency']
      const rows = invoices.rows.map(i => [
        i.invoice_number,
        i.client_name,
        i.business_name || '',
        i.status,
        i.issue_date,
        i.due_date,
        i.subtotal,
        i.tax_amount,
        i.total,
        i.amount_paid,
        i.balance_due,
        i.currency
      ])
      csvContent = [toCsvRow(headers), ...rows.map(toCsvRow)].join('\r\n')

    } else if (type === 'leads' || type === 'clients') {
      const clients = await query(`
        SELECT
          c.name,
          c.whatsapp_phone,
          c.email,
          c.business_name,
          c.industry,
          c.city,
          c.service_category,
          c.budget,
          c.lead_source,
          c.lifecycle_status,
          c.next_followup,
          c.created_at
        FROM clients c
        ORDER BY c.id DESC
      `)

      const headers = ['Lead Name', 'WhatsApp Phone', 'Email', 'Business Name', 'Industry', 'City', 'Service Required', 'Budget (INR)', 'Lead Source', 'Status', 'Next Followup', 'Created Date']
      const rows = clients.rows.map(c => [
        c.name,
        c.whatsapp_phone ? `+${c.whatsapp_phone}` : '',
        c.email || '',
        c.business_name || '',
        c.industry || '',
        c.city || '',
        c.service_category || '',
        c.budget || 0,
        c.lead_source || '',
        c.lifecycle_status,
        c.next_followup || '',
        c.created_at
      ])
      csvContent = [toCsvRow(headers), ...rows.map(toCsvRow)].join('\r\n')

    } else if (type === 'expenses') {
      const expenses = await query(`
        SELECT
          expense_date,
          category,
          amount,
          vendor,
          description,
          created_at
        FROM expenses
        ORDER BY expense_date DESC
      `)

      const headers = ['Date', 'Category', 'Amount (INR)', 'Vendor', 'Description', 'Logged At']
      const rows = expenses.rows.map(e => [
        e.expense_date,
        e.category,
        e.amount,
        e.vendor || '',
        e.description || '',
        e.created_at
      ])
      csvContent = [toCsvRow(headers), ...rows.map(toCsvRow)].join('\r\n')

    } else if (type === 'profitability') {
      const clientProfitability = await query(`
        SELECT
          c.name as client_name,
          c.business_name,
          COALESCE(pay.total_paid, 0) as total_paid,
          COALESCE(inv.total_invoiced, 0) as total_invoiced,
          COALESCE(inv.balance_due, 0) as balance_due
        FROM clients c
        LEFT JOIN (
          SELECT client_id, SUM(total) as total_invoiced, SUM(balance_due) as balance_due
          FROM invoices
          WHERE status != 'cancelled'
          GROUP BY client_id
        ) inv ON inv.client_id = c.id
        LEFT JOIN (
          SELECT client_id, SUM(amount) as total_paid
          FROM payments
          WHERE status = 'confirmed'
          GROUP BY client_id
        ) pay ON pay.client_id = c.id
        WHERE COALESCE(pay.total_paid, 0) > 0 OR COALESCE(inv.total_invoiced, 0) > 0
        ORDER BY total_paid DESC
      `)

      const headers = ['Client Name', 'Business Name', 'Total Collected (INR)', 'Total Invoiced (INR)', 'Outstanding (INR)']
      const rows = clientProfitability.rows.map(cp => [
        cp.client_name,
        cp.business_name || '',
        cp.total_paid,
        cp.total_invoiced,
        cp.balance_due
      ])
      csvContent = [toCsvRow(headers), ...rows.map(toCsvRow)].join('\r\n')

    } else {
      // Default: Payments / Transactions
      const payments = await query(`
        SELECT
          p.receipt_number,
          p.payment_date,
          c.name as client_name,
          c.business_name,
          p.amount,
          p.method,
          p.reference_id,
          p.status
        FROM payments p
        LEFT JOIN clients c ON p.client_id = c.id
        ORDER BY p.id DESC
      `)

      const headers = ['Receipt #', 'Date', 'Customer', 'Business', 'Amount (INR)', 'Method', 'Reference UTR', 'Status']
      const rows = payments.rows.map(p => [
        p.receipt_number || `TBW-RCP-${p.id}`,
        p.payment_date,
        p.client_name,
        p.business_name || '',
        p.amount,
        p.method || '',
        p.reference_id || '',
        p.status
      ])
      csvContent = [toCsvRow(headers), ...rows.map(toCsvRow)].join('\r\n')
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(csvContent)
  } catch (err) {
    next(err)
  }
})

// GET /api/reports/pdf - Executive summary PDF generation
router.get('/pdf', requireAuth, async (req, res, next) => {
  try {
    const { range = '30d' } = req.query

    // Aggregate summary numbers
    const leadStatsRes = await query(`
      SELECT
        COUNT(*)::int as total,
        SUM(CASE WHEN lifecycle_status = 'won' THEN 1 ELSE 0 END)::int as converted
      FROM clients
    `)
    const leadStats = leadStatsRes.rows[0]

    const convStatsRes = await query(`
      SELECT
        COUNT(*)::int as total,
        SUM(CASE WHEN mode = 'ai' THEN 1 ELSE 0 END)::int as ai_count,
        SUM(CASE WHEN mode = 'human' THEN 1 ELSE 0 END)::int as human_count
      FROM conversations
    `)
    const convStats = convStatsRes.rows[0]

    const invStatsRes = await query(`
      SELECT
        COALESCE(SUM(total), 0) as total_invoiced,
        COALESCE(SUM(balance_due), 0) as total_outstanding
      FROM invoices
      WHERE status != 'cancelled'
    `)
    const invStats = invStatsRes.rows[0]

    const payStatsRes = await query(`
      SELECT COALESCE(SUM(amount), 0) as total_collected
      FROM payments
      WHERE status = 'confirmed'
    `)
    const payStats = payStatsRes.rows[0]

    const expStatsRes = await query(`
      SELECT COALESCE(SUM(amount), 0) as total_expenses
      FROM expenses
    `)
    const expStats = expStatsRes.rows[0]

    const subStatsRes = await query(`
      SELECT COALESCE(SUM(monthly_fee), 0) as mrr
      FROM subscriptions
      WHERE status = 'active'
    `)
    const subStats = subStatsRes.rows[0]

    const projectStatsRes = await query(`
      SELECT
        COUNT(*)::int as total,
        SUM(CASE WHEN status IN ('planning', 'in_progress', 'review') THEN 1 ELSE 0 END)::int as in_dev
      FROM projects
    `)
    const projectStats = projectStatsRes.rows[0]

    const taskStatsRes = await query(`
      SELECT
        COUNT(*)::int as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)::int as completed
      FROM tasks
    `)
    const taskStats = taskStatsRes.rows[0]

    const apptStatsRes = await query(`
      SELECT
        COUNT(*)::int as total,
        SUM(CASE WHEN status = 'scheduled' AND start_time >= CURRENT_TIMESTAMP THEN 1 ELSE 0 END)::int as upcoming
      FROM appointments
    `)
    const apptStats = apptStatsRes.rows[0]

    const followupsDueRes = await query(`
      SELECT COUNT(*)::int as count
      FROM clients
      WHERE next_followup IS NOT NULL
        AND next_followup <= CURRENT_TIMESTAMP + INTERVAL '7 days'
        AND lifecycle_status NOT IN ('won', 'lost', 'archived')
    `)
    const followupsDue = followupsDueRes.rows[0]?.count || 0

    const automationErrorsRes = await query(`
      SELECT COUNT(*)::int as count
      FROM automation_integrations
      WHERE last_status = 'error'
    `)
    const automationErrors = automationErrorsRes.rows[0]?.count || 0

    const totalCollected = Number(payStats.total_collected) || 0
    const totalExpenses = Number(expStats.total_expenses) || 0
    const netProfit = totalCollected - totalExpenses
    const profitMargin = totalCollected > 0 ? Math.round((netProfit / totalCollected) * 100) : 0
    const totalLeads = Number(leadStats.total) || 0
    const convertedLeads = Number(leadStats.converted) || 0
    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0

    const reportData = {
      range: range.toUpperCase(),
      leads: {
        total: totalLeads,
        conversion_rate: conversionRate
      },
      whatsapp: {
        total_conversations: Number(convStats.total) || 0,
        ai_count: Number(convStats.ai_count) || 0,
        human_count: Number(convStats.human_count) || 0
      },
      finance: {
        total_invoiced: Number(invStats.total_invoiced) || 0,
        total_collected: totalCollected,
        total_outstanding: Number(invStats.total_outstanding) || 0,
        total_expenses: totalExpenses,
        net_profit: netProfit,
        profit_margin: profitMargin,
        mrr: Number(subStats.mrr) || 0
      },
      projects: {
        total: Number(projectStats.total) || 0,
        in_development: Number(projectStats.in_dev) || 0,
        tasks_total: Number(taskStats.total) || 0,
        tasks_completed: Number(taskStats.completed) || 0
      },
      appointments: {
        upcoming_count: Number(apptStats.upcoming) || 0,
        followups_due: followupsDue
      },
      automation: {
        healthy: automationErrors === 0
      }
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="tbw-executive-report-${range}-${Date.now()}.pdf"`)
    generateExecutiveReportPdf(reportData, res)
  } catch (err) {
    next(err)
  }
})

export default router
