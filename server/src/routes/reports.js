import { Router } from 'express'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
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
router.get('/export-csv', requireAuth, (req, res, next) => {
  try {
    const db = getDb()
    const { type = 'invoices' } = req.query

    let csvContent = ''
    let filename = `tbw-${type}-${Date.now()}.csv`

    if (type === 'invoices') {
      const invoices = db.prepare(`
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
      `).all()

      const headers = ['Invoice Number', 'Client Name', 'Business Name', 'Status', 'Issue Date', 'Due Date', 'Subtotal (INR)', 'Tax (INR)', 'Total (INR)', 'Paid (INR)', 'Balance Due (INR)', 'Currency']
      const rows = invoices.map(i => [
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
      const clients = db.prepare(`
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
      `).all()

      const headers = ['Lead Name', 'WhatsApp Phone', 'Email', 'Business Name', 'Industry', 'City', 'Service Required', 'Budget (INR)', 'Lead Source', 'Status', 'Next Followup', 'Created Date']
      const rows = clients.map(c => [
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
      const expenses = db.prepare(`
        SELECT
          expense_date,
          category,
          amount,
          vendor,
          description,
          created_at
        FROM expenses
        ORDER BY expense_date DESC
      `).all()

      const headers = ['Date', 'Category', 'Amount (INR)', 'Vendor', 'Description', 'Logged At']
      const rows = expenses.map(e => [
        e.expense_date,
        e.category,
        e.amount,
        e.vendor || '',
        e.description || '',
        e.created_at
      ])
      csvContent = [toCsvRow(headers), ...rows.map(toCsvRow)].join('\r\n')

    } else if (type === 'profitability') {
      const clientProfitability = db.prepare(`
        SELECT
          c.name as client_name,
          c.business_name,
          COALESCE(SUM(p.amount), 0) as total_paid,
          COALESCE(SUM(inv.total), 0) as total_invoiced,
          COALESCE(SUM(inv.balance_due), 0) as balance_due
        FROM clients c
        LEFT JOIN invoices inv ON inv.client_id = c.id AND inv.status != 'cancelled'
        LEFT JOIN payments p ON p.client_id = c.id AND p.status = 'confirmed'
        GROUP BY c.id
        HAVING total_paid > 0 OR total_invoiced > 0
        ORDER BY total_paid DESC
      `).all()

      const headers = ['Client Name', 'Business Name', 'Total Collected (INR)', 'Total Invoiced (INR)', 'Outstanding (INR)']
      const rows = clientProfitability.map(cp => [
        cp.client_name,
        cp.business_name || '',
        cp.total_paid,
        cp.total_invoiced,
        cp.balance_due
      ])
      csvContent = [toCsvRow(headers), ...rows.map(toCsvRow)].join('\r\n')

    } else {
      // Default: Payments / Transactions
      const payments = db.prepare(`
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
      `).all()

      const headers = ['Receipt #', 'Date', 'Customer', 'Business', 'Amount (INR)', 'Method', 'Reference UTR', 'Status']
      const rows = payments.map(p => [
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
router.get('/pdf', requireAuth, (req, res, next) => {
  try {
    const db = getDb()
    const { range = '30d' } = req.query

    // Aggregate summary numbers
    const leadStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN lifecycle_status = 'won' THEN 1 ELSE 0 END) as converted
      FROM clients
    `).get()

    const convStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN mode = 'ai' THEN 1 ELSE 0 END) as ai_count,
        SUM(CASE WHEN mode = 'human' THEN 1 ELSE 0 END) as human_count
      FROM conversations
    `).get()

    const invStats = db.prepare(`
      SELECT
        COALESCE(SUM(total), 0) as total_invoiced,
        COALESCE(SUM(balance_due), 0) as total_outstanding
      FROM invoices
      WHERE status != 'cancelled'
    `).get()

    const payStats = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total_collected
      FROM payments
      WHERE status = 'confirmed'
    `).get()

    const expStats = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total_expenses
      FROM expenses
    `).get()

    const subStats = db.prepare(`
      SELECT COALESCE(SUM(monthly_fee), 0) as mrr
      FROM subscriptions
      WHERE status = 'active'
    `).get()

    const projectStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('planning', 'in_progress', 'review') THEN 1 ELSE 0 END) as in_dev
      FROM projects
    `).get()

    const taskStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed
      FROM tasks
    `).get()

    const apptStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'scheduled' AND start_time >= datetime('now') THEN 1 ELSE 0 END) as upcoming
      FROM appointments
    `).get()

    const followupsDue = db.prepare(`
      SELECT COUNT(*) as count
      FROM clients
      WHERE next_followup IS NOT NULL
        AND next_followup <= datetime('now', '+7 days')
        AND lifecycle_status NOT IN ('won', 'lost', 'archived')
    `).get().count

    const automationErrors = db.prepare(`
      SELECT COUNT(*) as count
      FROM automation_integrations
      WHERE last_status = 'error'
    `).get().count

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
