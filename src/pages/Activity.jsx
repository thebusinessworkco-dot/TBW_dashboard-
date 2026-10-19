import { useState, useEffect, useCallback } from 'react'
import Icon from '../components/Icon'
import { Kpi, PageHead } from '../components/ui'
import { useApp } from '../lib/store'
import { stamp } from '../lib/format'
import { api } from '../lib/api'

export default function Activity() {
  const { toast, booting, go } = useApp()
  const [logs, setLogs] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [entityFilter, setEntityFilter] = useState('all')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const lead = booting ? 900 : 300

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      const offset = (page - 1) * pageSize
      let url = `/api/audit-log?limit=${pageSize}&offset=${offset}`
      if (search.trim()) url += `&action=${encodeURIComponent(search.trim())}`
      if (entityFilter !== 'all') url += `&entity_type=${encodeURIComponent(entityFilter)}`

      const res = await api.get(url)
      if (res.success && res.data) {
        setLogs(res.data.logs || [])
        setTotalCount(res.data.pagination?.total || 0)
      }
    } catch (err) {
      toast('Failed to load audit trail', err.message, { icon: 'close' })
    } finally {
      setLoading(false)
    }
  }, [page, search, entityFilter, toast])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const exportAuditCsv = () => {
    if (logs.length === 0) {
      toast('No Data', 'No audit logs available to export.', { icon: 'close' })
      return
    }
    const headers = ['ID', 'User', 'Action', 'Entity Type', 'Entity ID', 'IP Address', 'Timestamp', 'Details']
    const rows = logs.map(l => [
      l.id,
      `"${l.user_name || 'System'}"`,
      `"${l.action}"`,
      `"${l.entity_type}"`,
      l.entity_id || '',
      `"${l.ip_address || ''}"`,
      `"${l.created_at}"`,
      `"${(typeof l.details === 'object' ? JSON.stringify(l.details) : String(l.details || '')).replace(/"/g, '""')}"`
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tbw-audit-log-${Date.now()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast('Audit Exported', `${logs.length} records exported to CSV.`, { icon: 'download' })
  }

  const formatAction = (act) => {
    if (!act) return 'Action'
    return act.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  const getActionColor = (act) => {
    if (!act) return 'var(--ink)'
    if (act.includes('delete') || act.includes('reject') || act.includes('fail') || act.includes('error')) return 'var(--loss)'
    if (act.includes('create') || act.includes('accept') || act.includes('paid') || act.includes('confirm') || act.includes('won')) return 'var(--green)'
    return 'var(--accent)'
  }

  return (
    <>
      <PageHead
        title="Activity & Security Audit Trail"
        sub="Immutable real-time audit logs of every system change, user authentication, quotation, and payment."
      >
        <button type="button" className="btn ghost lg" onClick={fetchLogs}>
          <Icon name="refresh" size={17} />
          Refresh
        </button>
        <button type="button" className="btn solid lg" onClick={exportAuditCsv}>
          <Icon name="download" size={18} />
          Export CSV
        </button>
      </PageHead>

      <div className="kpis">
        <Kpi
          icon="receipt"
          label="Total Audited Events"
          value={totalCount}
          delta={totalCount > 0 ? 100 : 0}
          note="In database"
          delay={lead}
        />
        <Kpi
          icon="user"
          label="Recent Event Batch"
          value={logs.length}
          note={`Page ${page} of ${Math.max(1, Math.ceil(totalCount / pageSize))}`}
          d={70}
          delay={lead}
          tone="green"
        />
        <Kpi
          icon="lock"
          label="RBAC & Security"
          value="Enforced"
          note="Session validated"
          d={140}
          delay={lead}
          tone="accent"
        />
        <Kpi
          icon="clock"
          label="Latest Event"
          value={logs[0] ? stamp(logs[0].created_at) : 'None'}
          note="Real-time capture"
          d={210}
          delay={lead}
          tone="blue"
        />
      </div>

      <div className="act-layout">
        {/* Main Audit Trail Table */}
        <section className="card activity-card" style={{ '--d': '240ms', padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
            <h2 className="card-title big" style={{ margin: 0 }}>System Events</h2>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <label className="search-box" style={{ width: '220px' }}>
                <Icon name="search" size={16} />
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Filter by action..."
                />
              </label>

              <select
                value={entityFilter}
                onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
                style={{
                  height: '34px',
                  padding: '0 10px',
                  borderRadius: '9px',
                  border: '1px solid var(--line-2)',
                  background: 'var(--card)',
                  color: 'var(--ink)',
                  fontSize: '12.5px'
                }}
              >
                <option value="all">All Entities</option>
                <option value="auth">Auth & Sessions</option>
                <option value="client">Clients & Leads</option>
                <option value="quotation">Quotations</option>
                <option value="invoice">Invoices</option>
                <option value="payment">Payments</option>
                <option value="settings">Settings</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>
              <Icon name="refresh" size={28} />
              <p style={{ marginTop: '10px', fontSize: '13px' }}>Loading audit trail...</p>
            </div>
          ) : logs.length > 0 ? (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line-2)', color: 'var(--muted)', height: '36px' }}>
                      <th style={{ padding: '0 8px', fontWeight: 600 }}>ACTION</th>
                      <th style={{ padding: '0 8px', fontWeight: 600 }}>USER</th>
                      <th style={{ padding: '0 8px', fontWeight: 600 }}>ENTITY</th>
                      <th style={{ padding: '0 8px', fontWeight: 600 }}>DETAILS</th>
                      <th style={{ padding: '0 8px', fontWeight: 600 }}>IP ADDRESS</th>
                      <th style={{ padding: '0 8px', fontWeight: 600, textAlign: 'right' }}>TIMESTAMP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--line-2)', height: '44px' }}>
                        <td style={{ padding: '0 8px' }}>
                          <span style={{ fontWeight: 600, color: getActionColor(l.action) }}>
                            {formatAction(l.action)}
                          </span>
                        </td>
                        <td style={{ padding: '0 8px', color: 'var(--ink)' }}>
                          {l.user_name || 'System Worker'}
                        </td>
                        <td style={{ padding: '0 8px' }}>
                          <span style={{ background: 'var(--soft)', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', textTransform: 'uppercase' }}>
                            {l.entity_type} {l.entity_id ? `#${l.entity_id}` : ''}
                          </span>
                        </td>
                        <td style={{ padding: '0 8px', color: 'var(--muted)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {typeof l.details === 'object' ? JSON.stringify(l.details) : String(l.details || '—')}
                        </td>
                        <td style={{ padding: '0 8px', color: 'var(--muted)', fontSize: '11.5px' }}>
                          {l.ip_address || '127.0.0.1'}
                        </td>
                        <td style={{ padding: '0 8px', textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {stamp(l.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalCount > pageSize && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', fontSize: '12px', color: 'var(--muted)' }}>
                  <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount} events</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={page <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={page * pageSize >= totalCount}
                      onClick={() => setPage(p => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>
              <Icon name="note" size={32} />
              <h4 style={{ margin: '10px 0 4px', color: 'var(--ink)' }}>No Audit Events Found</h4>
              <p style={{ fontSize: '13px', margin: 0 }}>
                {search ? 'Try clearing your search query.' : 'System operations, logins and changes will record here.'}
              </p>
            </div>
          )}
        </section>

        {/* Live Feed Sidebar */}
        <section className="card feed-card" style={{ '--d': '320ms' }}>
          <div className="section-head rv" style={{ '--i': 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="card-title big">Live Feed</h2>
            <span className="live-dot">Live</span>
          </div>
          {logs.length > 0 ? (
            <ol className="timeline">
              {logs.slice(0, 7).map((a, i) => (
                <li key={a.id || i} className="rv" style={{ '--i': i + 1 }}>
                  <span className={`tl-dot ${a.action.includes('delete') || a.action.includes('error') ? 'red' : a.action.includes('create') || a.action.includes('accept') ? 'green' : 'amber'}`} />
                  <div className="tl-body" style={{ width: '100%', cursor: 'default' }}>
                    <span className="tl-txt" style={{ flex: 1 }}>
                      <strong>{formatAction(a.action)}</strong>
                      <small>{a.user_name || 'System Worker'} · {stamp(a.created_at)}</small>
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      #{a.entity_id || a.id}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div style={{ padding: '36px 12px', textAlign: 'center', color: 'var(--muted)' }}>
              <p style={{ fontSize: '12.5px', margin: 0 }}>No recent events recorded.</p>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
