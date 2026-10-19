import { Router } from 'express'
import { query } from '../_lib/db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'

const router = Router()

// GET /api/finance/analytics - Comprehensive financial health and profitability metrics
router.get('/analytics', requireAuth, requireRole('accountant', 'admin', 'owner'), async (req, res, next) => {
  try {
    // 1. Invoices Aggregates
    const invRes = await query(`
      SELECT
        COALESCE(SUM(total), 0) as total_invoiced,
        COALESCE(SUM(amount_paid), 0) as total_paid_against_invoices,
        COALESCE(SUM(balance_due), 0) as total_outstanding,
        COUNT(*) as invoice_count
      FROM invoices
      WHERE status != 'cancelled'
    `)
    const invStats = invRes.rows[0]

    // 2. Total Collected Revenue from all confirmed payments
    const payRes = await query(`
      SELECT
        COALESCE(SUM(amount), 0) as total_collected,
        COUNT(*) as payment_count
      FROM payments
      WHERE status = 'confirmed'
    `)
    const payStats = payRes.rows[0]

    // 3. Total Business Expenses
    const expRes = await query(`
      SELECT
        COALESCE(SUM(amount), 0) as total_expenses,
        COUNT(*) as expense_count
      FROM expenses
    `)
    const expStats = expRes.rows[0]

    // 4. Subscriptions MRR
    const subRes = await query(`
      SELECT
        COALESCE(SUM(monthly_fee), 0) as mrr,
        COUNT(*) as active_subscriptions
      FROM subscriptions
      WHERE status = 'active'
    `)
    const subStats = subRes.rows[0]

    // 5. Net Profit & Margin Calculation
    const totalCollected = Number(payStats.total_collected)
    const totalExpenses = Number(expStats.total_expenses)
    const netProfit = totalCollected - totalExpenses
    const profitMargin = totalCollected > 0 ? Math.round((netProfit / totalCollected) * 100) : 0

    // 6. Customer-Wise Profitability
    const customerProfitabilityRes = await query(`
      SELECT
        c.id as client_id,
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
      LIMIT 20
    `)

    // 7. Expenses by Category
    const expensesByCategoryRes = await query(`
      SELECT category, SUM(amount) as total
      FROM expenses
      GROUP BY category
      ORDER BY total DESC
    `)

    res.json({
      success: true,
      data: {
        summary: {
          total_invoiced: Number(invStats.total_invoiced),
          total_collected: totalCollected,
          total_outstanding: Number(invStats.total_outstanding),
          total_expenses: totalExpenses,
          net_profit: netProfit,
          profit_margin_percent: profitMargin,
          mrr: Number(subStats.mrr),
          active_subscriptions: parseInt(subStats.active_subscriptions, 10)
        },
        expenses_by_category: expensesByCategoryRes.rows,
        customer_profitability: customerProfitabilityRes.rows
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
