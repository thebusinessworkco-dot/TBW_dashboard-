import { useState, useEffect, useCallback } from 'react'
import Icon from '../components/Icon'
import { Flag } from '../components/Brand'
import { LineChart, PnlChart } from '../components/Charts'
import { CountUp, Delta, PageHead, Popover, Segmented } from '../components/ui'
import { useApp } from '../lib/store'
import { money, stamp } from '../lib/format'
import { api } from '../lib/api'

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '90d', label: '90 Days' },
  { key: 'all', label: 'All Time' },
]

export default function Overview() {
  const { user, go, toast, booting } = useApp()
  const [range, setRange] = useState('30d')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [recentAudits, setRecentAudits] = useState([])
  const [hotTile, setHotTile] = useState('leads')
  const lead = booting ? 1000 : 200

  const fetchAnalytics = useCallback(async (selectedRange) => {
    try {
      setLoading(true)
      const res = await api.get(`/api/analytics/dashboard?range=${selectedRange}`)
      if (res.success && res.data) {
        setData(res.data)
      }
    } catch (err) {
      toast('Failed to load analytics', err.message, { icon: 'close' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  const fetchAudits = useCallback(async () => {
    try {
      const res = await api.get('/api/audit-log?limit=8')
      if (res.success && Array.isArray(res.data?.logs)) {
        setRecentAudits(res.data.logs)
      }
    } catch {
      // Non-critical, fall back gracefully
    }
  }, [])

  useEffect(() => {
    fetchAnalytics(range)
  }, [range, fetchAnalytics])

  useEffect(() => {
    fetchAudits()
  }, [fetchAudits])

  const exportPdfReport = async () => {
    try {
      toast('Generating PDF', 'Preparing executive business intelligence report...', { icon: 'clock' })
      const token = localStorage.getItem('tbw_token')
      const headers = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${api.getBaseUrl()}/api/reports/pdf?range=${range}`, {
        headers,
        credentials: 'include'
      })
      if (!res.ok) throw new Error('Failed to generate report PDF')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tbw-executive-report-${range}-${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      toast('Report Downloaded', 'Executive PDF saved to your device.', { icon: 'download' })
    } catch (err) {
      toast('Export Failed', err.message, { icon: 'close' })
    }
  }

  // Fallbacks if data is loading
  const finance = data?.finance || { total_collected: 0, total_invoiced: 0, total_outstanding: 0, total_expenses: 0, net_profit: 0, profit_margin: 0, mrr: 0, active_subscriptions: 0, timeline: [] }
  const leads = data?.leads || { total: 0, qualified: 0, converted: 0, conversion_rate: 0 }
  const whatsapp = data?.whatsapp || { total_conversations: 0, unread: 0, ai_handled: 0, human_handled: 0, total_messages: 0, avg_response_time_sec: 0 }
  const quotations = data?.quotations || { total: 0, sent: 0, accepted: 0, rejected: 0, acceptance_rate: 0 }
  const projects = data?.projects || { total: 0, active: 0, completed: 0, total_tasks: 0, completed_tasks: 0, overdue_tasks: 0 }
  const appointments = data?.appointments || { total: 0, scheduled: 0, completed: 0, followups_due: 0 }
  const automation = data?.automation || { healthy: null, total_workflows: 0, recent_errors_count: 0 }
  const profitability = data?.profitability || { clients: [], services: [] }

  // Prepare chart series from backend timeline
  const chartLabels = finance.timeline?.length > 1
    ? finance.timeline.map(t => t.date.slice(5))
    : ['W1', 'W2', 'W3', 'W4']
  const incomeSeries = finance.timeline?.length > 1
    ? finance.timeline.map(t => Math.round(t.income / 1000))
    : [0, 0, 0, 0]
  const expenseSeries = finance.timeline?.length > 1
    ? finance.timeline.map(t => Math.round(t.expense / 1000))
    : [0, 0, 0, 0]

  return (
    <>
      <PageHead
        title={`Executive Command Center`}
        sub={`Real-time agency metrics for The Business Work. Logged in as ${user.name || 'Owner'}.`}
      >
        <Segmented items={RANGES} value={range} onChange={setRange} />
        <button type="button" className="btn solid lg" onClick={exportPdfReport}>
          <Icon name="download" size={18} />
          Executive PDF
        </button>
      </PageHead>

      <div className="ov-grid">
        {/* ---------------- 1. Total Balance & Cashflow Summary ---------------- */}
        <section className="card balance-card" style={{ '--d': '0ms' }}>
          <div className="bal-head rv" style={{ '--i': 0 }}>
            <span className="card-label">Collected Revenue</span>
            <span className="cur-btn" style={{ cursor: 'default' }}>
              <Flag code="in" size={19} />
              INR (₹)
            </span>
          </div>

          <div className="bal-amount rv" style={{ '--i': 1 }}>
            <CountUp
              value={finance.total_collected}
              format={(n) => money(n, '₹')}
              delay={lead}
              duration={1500}
            />
          </div>
          <div className="bal-delta rv" style={{ '--i': 2 }}>
            <Delta value={finance.profit_margin} />
            <span>Net Profit Margin: <b>{finance.profit_margin}%</b> (₹{finance.net_profit.toLocaleString('en-IN')})</span>
          </div>

          <div className="bal-actions rv" style={{ '--i': 3 }}>
            <button type="button" className="btn solid xl" onClick={() => go('quotations')}>
              <Icon name="receipt" size={20} />
              New Quote
            </button>
            <button type="button" className="btn soft xl" onClick={() => go('invoices')}>
              <Icon name="note" size={20} />
              Invoices
            </button>
          </div>

          <div className="wallets rv" style={{ '--i': 4 }}>
            <div className="wallets-head">
              <b>Core Financial Metrics</b>
              <i />
              <span>{RANGES.find(r => r.key === range)?.label}</span>
            </div>
            <div className="wallet-track">
              <div className="wallet active" style={{ '--w': 0 }}>
                <div className="w-head">
                  <Icon name="refresh" size={16} />
                  <b>MRR Recurring</b>
                </div>
                <strong>₹{finance.mrr.toLocaleString('en-IN')}/mo</strong>
                <small>{finance.active_subscriptions} active client subscriptions</small>
                <em>{finance.mrr > 0 ? 'Active Retainers' : 'No Active Subscriptions'}</em>
              </div>

              <div className="wallet active" style={{ '--w': 1 }}>
                <div className="w-head">
                  <Icon name="clock" size={16} />
                  <b>Outstanding Receivables</b>
                </div>
                <strong>₹{finance.total_outstanding.toLocaleString('en-IN')}</strong>
                <small>Total invoiced: ₹{finance.total_invoiced.toLocaleString('en-IN')}</small>
                <em>{finance.total_outstanding > 0 ? 'Pending Collection' : 'All Clear'}</em>
              </div>

              <div className="wallet active" style={{ '--w': 2 }}>
                <div className="w-head">
                  <Icon name="arrowUpRight" size={16} />
                  <b>Operating Expenses</b>
                </div>
                <strong>₹{finance.total_expenses.toLocaleString('en-IN')}</strong>
                <small>Tools, servers & ops costs</small>
                <em>Logged in Ledger</em>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- 2. Four Primary Interactive Stat Tiles ---------------- */}
        <section className="card stats-card" style={{ '--d': '90ms' }}>
          {/* Tile 1: Leads & CRM */}
          <button
            type="button"
            className={`stat ${hotTile === 'leads' ? 'hot' : ''}`}
            style={{ '--s': 0 }}
            onClick={() => setHotTile('leads')}
            aria-pressed={hotTile === 'leads'}
          >
            <span className="stat-glow" aria-hidden="true" />
            <span className="stat-head">
              <span>Lead Pipeline</span>
              <i className="stat-ic"><Icon name="users" size={17} /></i>
            </span>
            <strong className="stat-val">
              <CountUp value={leads.total} format={(n) => `${n} Leads`} delay={lead + 100} />
            </strong>
            <span className="stat-foot">
              <Delta value={leads.conversion_rate} glass={hotTile === 'leads'} />
              <span>{leads.qualified} Qual · {leads.conversion_rate}% Won</span>
            </span>
          </button>

          {/* Tile 2: Quotations */}
          <button
            type="button"
            className={`stat ${hotTile === 'quotes' ? 'hot' : ''}`}
            style={{ '--s': 1 }}
            onClick={() => setHotTile('quotes')}
            aria-pressed={hotTile === 'quotes'}
          >
            <span className="stat-glow" aria-hidden="true" />
            <span className="stat-head">
              <span>Quotations</span>
              <i className="stat-ic"><Icon name="receipt" size={17} /></i>
            </span>
            <strong className="stat-val">
              <CountUp value={quotations.sent} format={(n) => `${n} Sent`} delay={lead + 180} />
            </strong>
            <span className="stat-foot">
              <Delta value={quotations.acceptance_rate} glass={hotTile === 'quotes'} />
              <span>{quotations.accepted} Accepted ({quotations.acceptance_rate}%)</span>
            </span>
          </button>

          {/* Tile 3: WhatsApp Automation */}
          <button
            type="button"
            className={`stat ${hotTile === 'wa' ? 'hot' : ''}`}
            style={{ '--s': 2 }}
            onClick={() => setHotTile('wa')}
            aria-pressed={hotTile === 'wa'}
          >
            <span className="stat-glow" aria-hidden="true" />
            <span className="stat-head">
              <span>WhatsApp Chats</span>
              <i className="stat-ic"><Icon name="mail" size={17} /></i>
            </span>
            <strong className="stat-val">
              <CountUp value={whatsapp.total_conversations} format={(n) => `${n} Active`} delay={lead + 260} />
            </strong>
            <span className="stat-foot">
              <Delta value={whatsapp.unread > 0 ? -whatsapp.unread : 0} glass={hotTile === 'wa'} />
              <span>{whatsapp.ai_handled} AI · {whatsapp.human_handled} Human</span>
            </span>
          </button>

          {/* Tile 4: Active Projects */}
          <button
            type="button"
            className={`stat ${hotTile === 'projects' ? 'hot' : ''}`}
            style={{ '--s': 3 }}
            onClick={() => setHotTile('projects')}
            aria-pressed={hotTile === 'projects'}
          >
            <span className="stat-glow" aria-hidden="true" />
            <span className="stat-head">
              <span>Projects & Ops</span>
              <i className="stat-ic"><Icon name="layers" size={17} /></i>
            </span>
            <strong className="stat-val">
              <CountUp value={projects.active} format={(n) => `${n} In Dev`} delay={lead + 340} />
            </strong>
            <span className="stat-foot">
              <Delta value={projects.overdue_tasks > 0 ? -projects.overdue_tasks : 0} glass={hotTile === 'projects'} />
              <span>{projects.overdue_tasks} Overdue · {projects.completed} Delivered</span>
            </span>
          </button>
        </section>

        {/* ---------------- 3. Income vs Expenses Cashflow Chart ---------------- */}
        <section className="card income-card" style={{ '--d': '180ms' }}>
          <div className="section-head rv" style={{ '--i': 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 className="card-title big">Income vs Expenses</h2>
              <p className="card-sub">Real cashflow velocity based on confirmed payments and expenses (in ₹ thousands)</p>
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

          <div className="pnl-panel rv" style={{ '--i': 1 }}>
            {finance.timeline && finance.timeline.length > 0 ? (
              <LineChart
                labels={chartLabels}
                series={[
                  { name: 'Income (₹k)', values: incomeSeries, color: 'var(--accent)', fill: true },
                  { name: 'Expenses (₹k)', values: expenseSeries, color: 'var(--loss)' },
                ]}
                height={260}
                unit="k"
              />
            ) : (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)' }}>
                <Icon name="chart" size={32} />
                <h4 style={{ margin: '10px 0 4px', color: 'var(--ink)' }}>No Cashflow Data Recorded</h4>
                <p style={{ fontSize: '13px', maxWidth: '380px', margin: '0 auto' }}>
                  Confirmed payments and logged expenses will appear here on your cashflow chart in real time.
                </p>
                <div style={{ marginTop: '14px' }}>
                  <button type="button" className="btn soft sm" onClick={() => go('invoices')}>
                    Record First Payment
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ---------------- 4. Operations & Automation Health ---------------- */}
        <div className="ov-left">
          <section className="card limit-card" style={{ '--d': '260ms' }}>
            <h2 className="card-title rv" style={{ '--i': 0 }}>
              Agency Operations & Automation
            </h2>

            <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* n8n Status */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--soft)', borderRadius: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: automation.healthy === null ? 'var(--muted)' : automation.healthy ? 'var(--green)' : 'var(--red)' }} />
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>n8n Workflow Engine</span>
                </div>
                <span style={{ fontSize: '12px', fontWeight: 600, color: automation.healthy === null ? 'var(--muted)' : automation.healthy ? 'var(--green)' : 'var(--red)' }}>
                  {automation.healthy === null ? 'Checking Status' : automation.healthy ? `${automation.active_workflows || automation.total_workflows} Active Flows` : `${automation.recent_errors_count} Errors`}
                </span>
              </div>

              {/* Follow-ups Due */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--soft)', borderRadius: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                  <Icon name="calendar" size={16} />
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>Client Follow-ups Due</span>
                </div>
                <button type="button" className="btn ghost sm" onClick={() => go('contacts')} style={{ fontSize: '12px', fontWeight: 600 }}>
                  {appointments.followups_due} Due · View
                </button>
              </div>

              {/* Scheduled Meetings */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--soft)', borderRadius: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                  <Icon name="clock" size={16} />
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>Upcoming Appointments</span>
                </div>
                <button type="button" className="btn ghost sm" onClick={() => go('schedule')} style={{ fontSize: '12px', fontWeight: 600 }}>
                  {appointments.scheduled} Scheduled · Calendar
                </button>
              </div>
            </div>
          </section>

          {/* ---------------- 5. Top Client Profitability ---------------- */}
          <section className="card cards-card" style={{ '--d': '340ms' }}>
            <div className="cards-head rv" style={{ '--i': 0 }}>
              <span className="ring-ic"><Icon name="trend" size={20} /></span>
              <h2 className="card-title">Client Profitability</h2>
              <button type="button" className="add-new" onClick={() => go('savings')}>
                View all
              </button>
            </div>

            <div style={{ padding: '8px 16px 16px' }}>
              {profitability.clients && profitability.clients.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  {profitability.clients.slice(0, 4).map((c, i) => (
                    <div
                      key={c.client_id || i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '9px 12px',
                        background: 'var(--soft)',
                        borderRadius: '10px'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <b style={{ fontSize: '13px' }}>{c.client_name}</b>
                        <small style={{ color: 'var(--muted)', fontSize: '11px' }}>{c.business_name || 'Direct Client'}</small>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <strong style={{ fontSize: '13px', color: 'var(--accent)' }}>₹{Number(c.collected).toLocaleString('en-IN')}</strong>
                        {c.balance_due > 0 ? (
                          <div style={{ fontSize: '10px', color: 'var(--loss)' }}>₹{Number(c.balance_due).toLocaleString('en-IN')} due</div>
                        ) : (
                          <div style={{ fontSize: '10px', color: 'var(--green)' }}>Settled</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--muted)' }}>
                  <p style={{ fontSize: '12.5px', margin: 0 }}>No client billing records yet. Recorded payments will rank clients by lifetime value.</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ---------------- 6. Real Live Activity Feed (Audit Log) ---------------- */}
        <section className="card activity-card" style={{ '--d': '300ms' }}>
          <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 8px' }}>
            <div>
              <h2 className="card-title big">System Activity & Audit Trail</h2>
              <p className="card-sub" style={{ margin: 0 }}>Real security logs, client updates and billing events</p>
            </div>
            <button type="button" className="btn ghost sm" onClick={() => go('activity')}>
              Full Log
              <Icon name="arrowUpRight" size={15} />
            </button>
          </div>

          <div style={{ padding: '10px 20px 20px' }}>
            {recentAudits.length > 0 ? (
              <ol className="timeline">
                {recentAudits.map((a, i) => (
                  <li key={a.id || i} className="rv" style={{ '--i': i + 1 }}>
                    <span className="tl-dot green" />
                    <div className="tl-body" style={{ width: '100%', cursor: 'default' }}>
                      <span className="tl-txt" style={{ flex: 1 }}>
                        <strong style={{ textTransform: 'capitalize' }}>
                          {a.action ? a.action.replace(/_/g, ' ') : 'System Action'}
                        </strong>
                        <small>{a.user_name || 'System Worker'} · {stamp(a.created_at)}</small>
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--muted)', background: 'var(--soft)', padding: '2px 8px', borderRadius: '6px' }}>
                        {a.entity_type || 'system'} #{a.entity_id || ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div style={{ padding: '36px 12px', textAlign: 'center', color: 'var(--muted)' }}>
                <Icon name="refresh" size={26} />
                <p style={{ fontSize: '13px', marginTop: '8px' }}>No audit events logged in this session yet.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
