import { useState, useEffect } from 'react'
import Icon from '../components/Icon'
import { Empty, Kpi, Modal, PageHead } from '../components/ui'
import { useApp } from '../lib/store'
import { api } from '../lib/api'

export default function Savings() {
  const { toast } = useApp()
  const [analytics, setAnalytics] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [recordingExpense, setRecordingExpense] = useState(false)

  // Expense form
  const [form, setForm] = useState({
    category: 'Cloud Infrastructure',
    description: '',
    amount: '',
    vendor: '',
    expense_date: new Date().toISOString().split('T')[0]
  })

  const loadData = async () => {
    try {
      setLoading(true)
      const [anaRes, expRes] = await Promise.all([
        api.get('/api/finance/analytics').catch(() => ({ data: null })),
        api.get('/api/expenses').catch(() => ({ data: { items: [] } }))
      ])

      if (anaRes.data) {
        setAnalytics(anaRes.data)
      }
      setExpenses(expRes.data?.items || [])
    } catch (err) {
      console.error('Failed to load financial analytics:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreateExpense = async (e) => {
    e.preventDefault()
    if (!form.description.trim() || !Number(form.amount)) return

    try {
      const res = await api.post('/api/expenses', {
        ...form,
        amount: Number(form.amount)
      })

      if (res.success) {
        toast('Expense Recorded', `₹${Number(form.amount).toLocaleString('en-IN')} added to ${form.category}`, { icon: 'check' })
        setRecordingExpense(false)
        setForm({
          category: 'Cloud Infrastructure',
          description: '',
          amount: '',
          vendor: '',
          expense_date: new Date().toISOString().split('T')[0]
        })
        await loadData()
      }
    } catch (err) {
      toast('Error', err.message, { icon: 'close' })
    }
  }

  const s = analytics?.summary || {
    total_invoiced: 0,
    total_collected: 0,
    total_expenses: 0,
    net_profit: 0,
    profit_margin_percent: 0,
    mrr: 0
  }

  return (
    <>
      <PageHead
        title="Profitability &amp; Expenses"
        sub="Track real agency cash flow, operational costs, net profit margins, and customer profitability."
      >
        <button type="button" className="btn solid lg" onClick={() => setRecordingExpense(true)}>
          <Icon name="plus" size={18} />
          Record Expense
        </button>
      </PageHead>

      <div className="kpis four" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '22px' }}>
        <Kpi
          icon="coins"
          label="Collected Revenue"
          value={s.total_collected}
          format={(n) => `₹${n.toLocaleString('en-IN')}`}
          note="Cash in bank"
          tone="green"
        />
        <Kpi
          icon="arrowDown"
          label="Total Operating Costs"
          value={s.total_expenses}
          format={(n) => `₹${n.toLocaleString('en-IN')}`}
          note={`${expenses.length} Expense records`}
          tone="amber"
        />
        <Kpi
          icon="trend"
          label="Net Profit"
          value={s.net_profit}
          format={(n) => `₹${n.toLocaleString('en-IN')}`}
          note={`${s.profit_margin_percent}% profit margin`}
          tone={s.net_profit >= 0 ? 'green' : 'amber'}
        />
        <Kpi
          icon="layers"
          label="Active Retainers (MRR)"
          value={s.mrr}
          format={(n) => `₹${n.toLocaleString('en-IN')}/mo`}
          note={`${s.active_subscriptions || 0} Subscriptions`}
          tone="accent"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '22px', alignItems: 'start' }}>
        {/* Customer Profitability Table */}
        <section className="card" style={{ padding: '22px' }}>
          <div className="section-head" style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Customer-Wise Revenue &amp; Collections</h3>
          </div>

          {(analytics?.customer_profitability || []).length === 0 ? (
            <Empty icon="users" title="No customer revenue data yet" body="Confirmed payments will reflect client revenue here." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(analytics?.customer_profitability || []).map((c) => (
                <div
                  key={c.client_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    background: 'var(--soft)'
                  }}
                >
                  <div>
                    <strong style={{ display: 'block', fontSize: '13.5px' }}>{c.client_name}</strong>
                    <small style={{ color: 'var(--sub)' }}>{c.business_name || 'Direct Client'}</small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <b style={{ display: 'block', fontSize: '14px', color: 'var(--green)' }}>
                      ₹{Number(c.total_paid).toLocaleString('en-IN')}
                    </b>
                    {c.balance_due > 0 ? (
                      <small style={{ color: 'var(--amber)', fontSize: '11px' }}>Due: ₹{Number(c.balance_due).toLocaleString('en-IN')}</small>
                    ) : (
                      <small style={{ color: 'var(--sub)', fontSize: '11px' }}>Zero Due</small>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Expenses by Category */}
        <section className="card" style={{ padding: '22px' }}>
          <div className="section-head" style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Operational Expenses</h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
            {(analytics?.expenses_by_category || []).map((cat, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', paddingBottom: '6px', borderBottom: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--sub)' }}>{cat.category}</span>
                <b>₹{Number(cat.total).toLocaleString('en-IN')}</b>
              </div>
            ))}
          </div>

          <h4 style={{ margin: '14px 0 10px', fontSize: '13.5px', fontWeight: 700 }}>Recent Expense Entries</h4>
          {expenses.length === 0 ? (
            <small style={{ color: 'var(--sub)' }}>No expenses recorded yet.</small>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
              {expenses.slice(0, 10).map((e) => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--soft)', borderRadius: '8px', fontSize: '12px' }}>
                  <div>
                    <b>{e.description}</b> · <span style={{ color: 'var(--sub)' }}>{e.category}</span>
                  </div>
                  <span style={{ fontWeight: 600 }}>₹{Number(e.amount).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* MODAL: Record Expense */}
      <Modal open={recordingExpense} onClose={() => setRecordingExpense(false)} title="Record Expense" sub="Track software subscriptions, VPS hosting, Meta API balances, and operational costs.">
        <form className="form" onSubmit={handleCreateExpense}>
          <div className="field-row">
            <label className="field">
              <span>Category *</span>
              <select
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                required
              >
                <option value="Cloud Infrastructure">Cloud Infrastructure &amp; VPS</option>
                <option value="Meta WhatsApp API">Meta WhatsApp API Charges</option>
                <option value="Software & SaaS">Software &amp; LLM API Keys</option>
                <option value="Marketing & Ads">Marketing &amp; Lead Gen</option>
                <option value="Office & Admin">Office &amp; Administrative</option>
                <option value="Professional Services">Legal &amp; Accounting</option>
              </select>
            </label>

            <label className="field">
              <span>Amount (INR) *</span>
              <input
                type="number"
                min="1"
                value={form.amount}
                onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                placeholder="e.g. 5000"
                required
              />
            </label>
          </div>

          <label className="field">
            <span>Description *</span>
            <input
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="e.g. Hetzner Cloud VPS renewal for Oct"
              required
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Vendor / Provider</span>
              <input
                value={form.vendor}
                onChange={(e) => setForm((prev) => ({ ...prev, vendor: e.target.value }))}
                placeholder="e.g. Hetzner, Meta, OpenAI"
              />
            </label>

            <label className="field">
              <span>Expense Date</span>
              <input
                type="date"
                value={form.expense_date}
                onChange={(e) => setForm((prev) => ({ ...prev, expense_date: e.target.value }))}
                required
              />
            </label>
          </div>

          <button type="submit" className="btn solid lg block" disabled={!form.description.trim() || !Number(form.amount)}>
            <Icon name="check" size={17} />
            Save Expense Record
          </button>
        </form>
      </Modal>
    </>
  )
}
