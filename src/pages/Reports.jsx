import { useState, useEffect, useCallback } from 'react'
import Icon from '../components/Icon'
import { Donut, LineChart } from '../components/Charts'
import { Kpi, PageHead, Segmented } from '../components/ui'
import { useApp } from '../lib/store'
import { api } from '../lib/api'

const PALETTE = ['var(--accent)', 'var(--loss)', '#f5b400', '#3f74f6', '#22a05a', '#a855f7', '#ec4899']
const PERIODS = [
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '90d', label: '90 Days' },
  { key: 'all', label: 'All Time' },
]

export default function Reports() {
  const { toast, booting } = useApp()
  const [period, setPeriod] = useState('30d')
  const [slice, setSlice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [analytics, setAnalytics] = useState(null)
  const [financeData, setFinanceData] = useState(null)
  const lead = booting ? 900 : 250

  const fetchData = useCallback(async (p) => {
    try {
      setLoading(true)
      const [anRes, finRes] = await Promise.all([
        api.get(`/api/analytics/dashboard?range=${p}`),
        api.get('/api/finance/analytics')
      ])
      if (anRes.success && anRes.data) setAnalytics(anRes.data)
      if (finRes.success && finRes.data) setFinanceData(finRes.data)
    } catch (err) {
      toast('Failed to load reports', err.message, { icon: 'close' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchData(period)
  }, [period, fetchData])

  const downloadCsv = async (type) => {
    try {
      toast('Exporting CSV', `Preparing ${type} export from database...`, { icon: 'clock' })
      const token = localStorage.getItem('tbw_token')
      const headers = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${api.getBaseUrl()}/api/reports/export-csv?type=${type}`, {
        headers,
        credentials: 'include'
      })
      if (!res.ok) throw new Error('Failed to export CSV')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tbw-${type}-${Date.now()}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      toast('Export Ready', `${type.toUpperCase()} CSV downloaded successfully.`, { icon: 'download' })
    } catch (err) {
      toast('Export Failed', err.message, { icon: 'close' })
    }
  }

  const downloadPdf = async () => {
    try {
      toast('Generating PDF', 'Preparing executive report...', { icon: 'clock' })
      const token = localStorage.getItem('tbw_token')
      const headers = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${api.getBaseUrl()}/api/reports/pdf?range=${period}`, {
        headers,
        credentials: 'include'
      })
      if (!res.ok) throw new Error('Failed to generate report PDF')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tbw-executive-report-${period}-${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      toast('Report Saved', 'Executive PDF saved to your device.', { icon: 'download' })
    } catch (err) {
      toast('Export Failed', err.message, { icon: 'close' })
    }
  }

  const fin = analytics?.finance || { total_collected: 0, total_expenses: 0, net_profit: 0, profit_margin: 0, timeline: [] }
  const categoriesRaw = financeData?.expenses_by_category || []
  const categories = categoriesRaw.map(c => ({ name: c.category || 'General', v: Number(c.total) || 0 }))
  const catTotal = categories.reduce((s, c) => s + c.v, 0)
  const focus = slice != null && categories[slice] ? categories[slice] : null

  const chartLabels = fin.timeline?.length > 1
    ? fin.timeline.map(t => t.date.slice(5))
    : ['W1', 'W2', 'W3', 'W4']
  const incomeSeries = fin.timeline?.length > 1
    ? fin.timeline.map(t => Math.round(t.income / 1000))
    : [0, 0, 0, 0]
  const expenseSeries = fin.timeline?.length > 1
    ? fin.timeline.map(t => Math.round(t.expense / 1000))
    : [0, 0, 0, 0]

  const formatInrK = (n) => `₹${Math.round(n / 1000).toLocaleString('en-IN')}k`

  return (
    <>
      <PageHead title="Financial Intelligence & Reports" sub="Audit-grade agency analytics, cashflow breakdowns, and multi-format exports.">
        <Segmented items={PERIODS} value={period} onChange={setPeriod} />
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn ghost lg"
            onClick={() => downloadCsv('invoices')}
          >
            <Icon name="download" size={17} />
            CSV Export
          </button>
          <button
            type="button"
            className="btn solid lg"
            onClick={downloadPdf}
          >
            <Icon name="note" size={18} />
            Executive PDF
          </button>
        </div>
      </PageHead>

      <div className="kpis" key={period}>
        <Kpi
          icon="arrowDown"
          label="Collected Revenue"
          value={fin.total_collected}
          format={(n) => `₹${Math.round(n).toLocaleString('en-IN')}`}
          delta={fin.profit_margin}
          note="vs operational costs"
          delay={lead}
          tone="green"
        />
        <Kpi
          icon="arrowUpRight"
          label="Total Expenses"
          value={fin.total_expenses}
          format={(n) => `₹${Math.round(n).toLocaleString('en-IN')}`}
          delta={fin.total_expenses > 0 ? -5 : 0}
          note="Logged business expenses"
          d={70}
          delay={lead}
          tone="accent"
        />
        <Kpi
          icon="trend"
          label="Net Profit"
          value={fin.net_profit}
          format={(n) => `₹${Math.round(n).toLocaleString('en-IN')}`}
          delta={fin.profit_margin}
          note="Net profit after expenses"
          d={140}
          delay={lead}
        />
        <Kpi
          icon="pie"
          label="Profit Margin"
          value={fin.profit_margin}
          format={(n) => `${n}%`}
          note="of collected cashflow kept"
          d={210}
          delay={lead}
          tone="blue"
        />
      </div>

      <div className="reports-grid">
        {/* ---------------- 1. Income vs Expenses Timeline ---------------- */}
        <section className="card chart-card" style={{ '--d': '200ms' }}>
          <div className="section-head rv" style={{ '--i': 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 className="card-title big">Income vs Expenses Velocity</h2>
              <p className="card-sub">Real database transaction velocity across the selected date range (in ₹ thousands)</p>
            </div>
            <div className="legend static" style={{ display: 'flex', gap: '14px', fontSize: '12px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="sw" style={{ background: 'var(--accent)', width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
                Collections
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="sw" style={{ background: 'var(--loss)', width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
                Expenses
              </span>
            </div>
          </div>
          <div className="rv" style={{ '--i': 1 }} key={period}>
            {fin.timeline && fin.timeline.length > 0 ? (
              <LineChart
                labels={chartLabels}
                series={[
                  { name: 'Income (₹k)', values: incomeSeries, color: 'var(--accent)', fill: true },
                  { name: 'Expenses (₹k)', values: expenseSeries, color: 'var(--loss)' },
                ]}
                height={270}
                unit="k"
              />
            ) : (
              <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--muted)' }}>
                <Icon name="chart" size={36} />
                <h4 style={{ margin: '12px 0 6px', color: 'var(--ink)' }}>No Timeline Transactions Recorded</h4>
                <p style={{ fontSize: '13px', maxWidth: '400px', margin: '0 auto' }}>
                  Confirmed payments and ledger expenses logged in the system will automatically stream to this timeline chart.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ---------------- 2. Spending by Category ---------------- */}
        <section className="card donut-card" style={{ '--d': '280ms' }}>
          <div className="section-head rv" style={{ '--i': 0 }}>
            <h2 className="card-title big">Expenses by Category</h2>
            <p className="card-sub">Infrastructure, APIs, tools and operational costs</p>
          </div>
          {categories.length > 0 && catTotal > 0 ? (
            <>
              <div className="donut-wrap rv" style={{ '--i': 1 }} key={period}>
                <Donut data={categories} colors={PALETTE} active={slice} onActive={setSlice}>
                  <small>{focus ? focus.name : 'Total Expenses'}</small>
                  <strong>₹{focus ? Math.round(focus.v).toLocaleString('en-IN') : Math.round(catTotal).toLocaleString('en-IN')}</strong>
                  <em>{focus ? `${((focus.v / catTotal) * 100).toFixed(1)}%` : `${categories.length} Categories`}</em>
                </Donut>
              </div>
              <ul className="cat-list">
                {categories.map((c, i) => (
                  <li
                    key={c.name}
                    className={`rv ${slice === i ? 'hot' : ''} ${slice != null && slice !== i ? 'dim' : ''}`}
                    style={{ '--i': i + 2 }}
                    onMouseEnter={() => setSlice(i)}
                    onMouseLeave={() => setSlice(null)}
                  >
                    <i className="sw" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span>{c.name}</span>
                    <div className="cat-bar">
                      <span style={{ width: `${Math.min(100, (c.v / catTotal) * 100)}%`, background: PALETTE[i % PALETTE.length] }} />
                    </div>
                    <b>{((c.v / catTotal) * 100).toFixed(0)}%</b>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--muted)' }}>
              <Icon name="pie" size={36} />
              <h4 style={{ margin: '12px 0 6px', color: 'var(--ink)' }}>No Category Expenses</h4>
              <p style={{ fontSize: '13px', margin: 0 }}>
                Logged operational expenses in the Profitability section will break down costs here.
              </p>
            </div>
          )}
        </section>

        {/* ---------------- 3. Ready Reports & Exports ---------------- */}
        <section className="card statements-card" style={{ '--d': '340ms' }}>
          <div className="section-head rv" style={{ '--i': 0 }}>
            <h2 className="card-title big">Official Export Ledgers</h2>
            <span className="muted">Direct database exports</span>
          </div>
          <div className="statement-list">
            <div className="statement rv" style={{ '--i': 1 }}>
              <span className="doc-ic"><Icon name="note" size={20} /></span>
              <span className="control-txt">
                <strong>Invoices & Billing Ledger</strong>
                <small>All issued client invoices, payment status, and balances</small>
              </span>
              <button
                type="button"
                className="icon-btn soft"
                aria-label="Download Invoices CSV"
                onClick={() => downloadCsv('invoices')}
              >
                <Icon name="download" size={18} />
              </button>
            </div>

            <div className="statement rv" style={{ '--i': 2 }}>
              <span className="doc-ic"><Icon name="users" size={20} /></span>
              <span className="control-txt">
                <strong>CRM & Lead Database</strong>
                <small>Full leads list, lifecycle status, contacts, and pipeline data</small>
              </span>
              <button
                type="button"
                className="icon-btn soft"
                aria-label="Download Leads CSV"
                onClick={() => downloadCsv('leads')}
              >
                <Icon name="download" size={18} />
              </button>
            </div>

            <div className="statement rv" style={{ '--i': 3 }}>
              <span className="doc-ic"><Icon name="arrowUpRight" size={20} /></span>
              <span className="control-txt">
                <strong>Operational Expenses Ledger</strong>
                <small>Itemized tools, servers, AI API bills, and vendor expenses</small>
              </span>
              <button
                type="button"
                className="icon-btn soft"
                aria-label="Download Expenses CSV"
                onClick={() => downloadCsv('expenses')}
              >
                <Icon name="download" size={18} />
              </button>
            </div>

            <div className="statement rv" style={{ '--i': 4 }}>
              <span className="doc-ic"><Icon name="trend" size={20} /></span>
              <span className="control-txt">
                <strong>Client Profitability Breakdown</strong>
                <small>Lifetime value, collections and receivables per client</small>
              </span>
              <button
                type="button"
                className="icon-btn soft"
                aria-label="Download Profitability CSV"
                onClick={() => downloadCsv('profitability')}
              >
                <Icon name="download" size={18} />
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
