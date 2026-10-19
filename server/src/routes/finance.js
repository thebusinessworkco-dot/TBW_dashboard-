import { Router } from 'express'
import { getDb } from '../db/connection.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'

const router = Router()

// GET /api/finance/analytics - Comprehensive financial health and profitability metrics
router.get('/analytics', requireAuth, requireRole('accountant', 'admin', 'owner'), (req, res, next) => {
  try {
    const db = getDb()

    // 1. Invoices Aggregates
    const invStats = db.prepare(`
      SELECT
        COALESCE(SUM(total), 0) as total_invoiced,
        COALESCE(SUM(amount_paid), 0) as total_paid_against_invoices,
        COALESCE(SUM(balance_due), 0) as total_outstanding,
        COUNT(*) as invoice_count
      FROM invoices
      WHERE status != 'cancelled'
    `).get()

    // 2. Total Collected Revenue from all confirmed payments
    const payStats = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as total_collected,
        COUNT(*) as payment_count
      FROM payments
      WHERE status = 'confirmed'
    `).get()

    // 3. Total Business Expenses
    const expStats = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as total_expenses,
        COUNT(*) as expense_count
      FROM expenses
    `).get()

    // 4. Subscriptions MRR
    const subStats = db.prepare(`
      SELECT
        COALESCE(SUM(monthly_fee), 0) as mrr,
        COUNT(*) as active_subscriptions
      FROM subscriptions
      WHERE status = 'active'
    `).get()

    // 5. Net Profit & Margin Calculation
    const totalCollected = Number(payStats.total_collected)
    const totalExpenses = Number(expStats.total_expenses)
    const netProfit = totalCollected - totalExpenses
    const profitMargin = totalCollected > 0 ? Math.round((netProfit / totalCollected) * 100) : 0

    // 6. Customer-Wise Profitability
    const customerProfitability = db.prepare(`
      SELECT
        c.id as client_id,
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
      LIMIT 20
    `).all()

    // 7. Expenses by Category
    const expensesByCategory = db.prepare(`
      SELECT category, SUM(amount) as total
      FROM expenses
      GROUP BY category
      ORDER BY total DESC
    `).all()

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
          active_subscriptions: subStats.active_subscriptions
        },
        expenses_by_category: expensesByCategory,
        customer_profitability: customerProfitability
      }
    })
  } catch (err) {
    next(err)
  }
})

export default router
