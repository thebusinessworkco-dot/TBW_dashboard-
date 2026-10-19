import { useState, useEffect, useCallback } from 'react'
import Icon from '../components/Icon'
import { Persona } from '../components/Brand'
import { Empty, Kpi, Modal, PageHead, Segmented } from '../components/ui'
import { useApp } from '../lib/store'
import { money } from '../lib/format'
import { api } from '../lib/api'

const LIFECYCLE_STAGES = [
  { key: 'all', label: 'All' },
  { key: 'new_lead', label: 'New Leads' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'proposal_sent', label: 'Proposals' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' }
]

function statusColor(status) {
  switch (status) {
    case 'won': return { bg: 'rgba(34, 197, 94, 0.15)', text: '#16a34a' }
    case 'proposal_sent': return { bg: 'rgba(245, 158, 11, 0.15)', text: '#d97706' }
    case 'qualified': return { bg: 'rgba(99, 102, 241, 0.15)', text: '#4f46e5' }
    case 'contacted': return { bg: 'rgba(14, 165, 233, 0.15)', text: '#0284c7' }
    case 'lost': return { bg: 'rgba(239, 68, 68, 0.15)', text: '#dc2626' }
    default: return { bg: 'var(--soft)', text: 'var(--ink)' }
  }
}

export default function Contacts() {
  const { go, toast } = useApp()
  const [clients, setClients] = useState([])
  const [trashClients, setTrashClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [viewTrash, setViewTrash] = useState(false)

  // Modals & Drawers
  const [adding, setAdding] = useState(false)
  const [editingClient, setEditingClient] = useState(null)
  const [activeClient, setActiveClient] = useState(null)
  const [detailData, setDetailData] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // Sync state
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  // New Client Form
  const [form, setForm] = useState({
    name: '',
    whatsapp_phone: '',
    email: '',
    business_name: '',
    industry: '',
    city: 'Mumbai',
    country: 'India',
    language: 'English',
    service_category: 'WhatsApp AI Automation',
    requirement: '',
    budget: '',
    lead_source: 'WhatsApp Inbound',
    lifecycle_status: 'new_lead',
    next_followup: ''
  })

  // Edit Client Form
  const [editForm, setEditForm] = useState({})

  const loadClients = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/api/clients?limit=200')
      setClients(res.data?.items || [])
    } catch (err) {
      console.error('Failed to load clients:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTrash = useCallback(async () => {
    try {
      const res = await api.get('/api/clients/trash')
      setTrashClients(res.data || [])
    } catch (err) {
      console.error('Failed to load trash:', err)
    }
  }, [])

  const loadSyncStatus = useCallback(async () => {
    try {
      const res = await api.get('/api/clients/sync-status')
      if (res.success) {
        setSyncStatus(res.data)
      }
    } catch (err) {
      console.error('Failed to load sync status:', err)
    }
  }, [])

  useEffect(() => {
    loadClients()
    loadSyncStatus()
  }, [loadClients, loadSyncStatus])

  useEffect(() => {
    if (viewTrash) {
      loadTrash()
    }
  }, [viewTrash, loadTrash])

  // Load Client Detail for Drawer
  const openDetail = async (client) => {
    setActiveClient(client)
    try {
      const res = await api.get(`/api/clients/${client.id}`)
      setDetailData(res.data)
    } catch (err) {
      toast('Error', 'Failed to load client details', { icon: 'close' })
    }
  }

  // Handle Pipeline Status Change
  const updateStatus = async (clientId, newStatus) => {
    try {
      await api.patch(`/api/clients/${clientId}/status`, { status: newStatus })
      toast('Status Updated', `Moved to ${newStatus.replace('_', ' ')}`, { icon: 'check' })
      await loadClients()
      if (activeClient && activeClient.id === clientId) {
        const res = await api.get(`/api/clients/${clientId}`)
        setDetailData(res.data)
      }
    } catch (err) {
      toast('Update Failed', err.message, { icon: 'close' })
    }
  }

  // Trigger Google Sheets Two-Way Sync
  const handleSyncSheets = async () => {
    try {
      setSyncing(true)
      const res = await api.post('/api/clients/sync-sheets')
      if (res.code === 'CONFIG_REQUIRED') {
        toast('Setup Required', 'Set GOOGLE_SHEETS_SPREADSHEET_ID and Google credentials to enable live sync.', { icon: 'info', ms: 5000 })
      } else if (res.success) {
        const d = res.data
        toast(
          'Google Sheets Synced',
          `Imported: ${d.imported} | Updated: ${d.updated} | Exported: ${d.exported}`,
          { icon: 'check' }
        )
        await loadClients()
        await loadSyncStatus()
      } else {
        toast('Sync Failed', res.error?.message || 'Google Sheets sync error', { icon: 'close' })
      }
    } catch (err) {
      toast('Sync Error', err.message || 'Network error during sync', { icon: 'close' })
    } finally {
      setSyncing(false)
    }
  }

  // Authenticated CSV Export
  const handleExportCsv = () => {
    try {
      const token = localStorage.getItem('tbw_token')
      const exportUrl = `${api.getBaseUrl()}/api/clients/export-csv`
      const a = document.createElement('a')
      a.href = `${exportUrl}?auth=${encodeURIComponent(token || '')}`
      // Use direct fetch download to pass auth headers securely
      fetch(exportUrl, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.blob())
        .then(blob => {
          const url = window.URL.createObjectURL(blob)
          const downloadAnchor = document.createElement('a')
          downloadAnchor.href = url
          downloadAnchor.download = `tbw_leads_${new Date().toISOString().split('T')[0]}.csv`
          document.body.appendChild(downloadAnchor)
          downloadAnchor.click()
          window.URL.revokeObjectURL(url)
          document.body.removeChild(downloadAnchor)
          toast('Export Downloaded', 'Lead spreadsheet downloaded successfully.', { icon: 'download' })
        })
        .catch(() => {
          toast('Export Failed', 'Could not generate CSV export', { icon: 'close' })
        })
    } catch (err) {
      toast('Export Error', err.message, { icon: 'close' })
    }
  }

  // Soft Delete Client (Move to Trash)
  const handleSoftDelete = async (clientId) => {
    try {
      await api.delete(`/api/clients/${clientId}`)
      toast('Lead Moved to Trash', 'Lead was soft-deleted. It can be restored anytime from Trash.', { icon: 'trash' })
      setDeleteConfirm(null)
      if (activeClient?.id === clientId) {
        setActiveClient(null)
        setDetailData(null)
      }
      await loadClients()
      await loadSyncStatus()
    } catch (err) {
      toast('Delete Failed', err.message, { icon: 'close' })
    }
  }

  // Restore Client from Trash
  const handleRestore = async (clientId) => {
    try {
      await api.post(`/api/clients/${clientId}/restore`)
      toast('Lead Restored', 'Lead returned to active CRM pipeline.', { icon: 'check' })
      await loadTrash()
      await loadClients()
      await loadSyncStatus()
    } catch (err) {
      toast('Restore Failed', err.message, { icon: 'close' })
    }
  }

  // Permanent Delete Client
  const handlePermanentDelete = async (clientId) => {
    if (!window.confirm('Are you sure you want to PERMANENTLY remove this lead? This cannot be undone.')) {
      return
    }
    try {
      const res = await api.delete(`/api/clients/${clientId}/permanent`)
      if (res.success) {
        toast('Permanently Deleted', 'Lead removed from database.', { icon: 'trash' })
        await loadTrash()
      }
    } catch (err) {
      toast('Permanent Deletion Blocked', err.message || 'Cannot delete lead with invoices/quotes', { icon: 'close' })
    }
  }

  // Open Edit Modal
  const openEditModal = (client) => {
    setEditingClient(client)
    setEditForm({
      name: client.name || '',
      whatsapp_phone: client.whatsapp_phone || '',
      email: client.email || '',
      business_name: client.business_name || '',
      industry: client.industry || '',
      city: client.city || 'Mumbai',
      country: client.country || 'India',
      language: client.language || 'English',
      service_category: client.service_category || 'WhatsApp AI Automation',
      requirement: client.requirement || '',
      budget: client.budget || '',
      lead_source: client.lead_source || 'WhatsApp Inbound',
      lifecycle_status: client.lifecycle_status || 'new_lead',
      next_followup: client.next_followup ? client.next_followup.split('T')[0] : ''
    })
  }

  // Handle Edit Submit
  const handleUpdateClient = async (e) => {
    e.preventDefault()
    if (!editForm.name.trim() || !editingClient) return

    try {
      const payload = {
        ...editForm,
        budget: editForm.budget ? Number(editForm.budget) : null
      }
      const res = await api.put(`/api/clients/${editingClient.id}`, payload)
      if (res.success) {
        toast('Lead Updated', `${editForm.name} updated successfully.`, { icon: 'check' })
        setEditingClient(null)
        await loadClients()
        if (activeClient && activeClient.id === editingClient.id) {
          const detailRes = await api.get(`/api/clients/${editingClient.id}`)
          setDetailData(detailRes.data)
        }
      }
    } catch (err) {
      toast('Update Failed', err.message, { icon: 'close' })
    }
  }

  // Add Internal Note
  const handleAddNote = async (e) => {
    e.preventDefault()
    if (!newNote.trim() || !activeClient) return
    try {
      setSavingNote(true)
      await api.post(`/api/clients/${activeClient.id}/notes`, { content: newNote.trim() })
      setNewNote('')
      const res = await api.get(`/api/clients/${activeClient.id}`)
      setDetailData(res.data)
      toast('Note Saved', 'Internal note added to client record.', { icon: 'check' })
    } catch (err) {
      toast('Error', 'Failed to add note', { icon: 'close' })
    } finally {
      setSavingNote(false)
    }
  }

  // Add Client Submit
  const handleCreateClient = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return

    try {
      const payload = {
        ...form,
        budget: form.budget ? Number(form.budget) : null
      }
      const res = await api.post('/api/clients', payload)
      if (res.success) {
        toast('Lead Created', `${form.name} added to CRM pipeline.`, { icon: 'check' })
        setAdding(false)
        setForm({
          name: '',
          whatsapp_phone: '',
          email: '',
          business_name: '',
          industry: '',
          city: 'Mumbai',
          country: 'India',
          language: 'English',
          service_category: 'WhatsApp AI Automation',
          requirement: '',
          budget: '',
          lead_source: 'WhatsApp Inbound',
          lifecycle_status: 'new_lead',
          next_followup: ''
        })
        await loadClients()
      }
    } catch (err) {
      if (err.code === 'PHONE_EXISTS') {
        toast('Duplicate Phone', 'A client with this WhatsApp phone number already exists.', { icon: 'info' })
      } else {
        toast('Creation Failed', err.message || 'Could not save lead', { icon: 'close' })
      }
    }
  }

  // Filter clients
  const filtered = clients.filter((c) => {
    if (filter !== 'all' && c.lifecycle_status !== filter) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.business_name && c.business_name.toLowerCase().includes(q)) ||
      (c.whatsapp_phone && c.whatsapp_phone.includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.requirement && c.requirement.toLowerCase().includes(q))
    )
  })

  // Filter trash
  const filteredTrash = trashClients.filter((c) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.business_name && c.business_name.toLowerCase().includes(q)) ||
      (c.whatsapp_phone && c.whatsapp_phone.includes(q))
    )
  })

  // KPI Calculations
  const totalLeads = clients.length
  const qualifiedCount = clients.filter((c) => c.lifecycle_status === 'qualified').length
  const proposalCount = clients.filter((c) => c.lifecycle_status === 'proposal_sent').length
  const wonCount = clients.filter((c) => c.lifecycle_status === 'won').length
  const pipelineValue = clients.reduce((acc, c) => acc + (Number(c.budget) || 0), 0)

  return (
    <>
      <PageHead
        title="CRM &amp; Lead Pipeline"
        sub="Track agency leads, Google Sheets synchronizations, WhatsApp inquiries, qualifications, and conversions."
      >
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            title="Download verified CSV of CRM leads"
            onClick={handleExportCsv}
          >
            <Icon name="download" size={16} />
            Export CSV
          </button>

          <button
            type="button"
            className="btn"
            title="Two-way live synchronization with Google Sheets"
            onClick={handleSyncSheets}
            disabled={syncing}
            style={{ position: 'relative' }}
          >
            <span style={{ display: 'inline-block', animation: syncing ? 'spin 1s linear infinite' : 'none' }}>
              <Icon name="refresh" size={16} />
            </span>
            {syncing ? 'Syncing Sheets...' : 'Sync Google Sheets'}
          </button>

          <button
            type="button"
            className={`btn ${viewTrash ? 'solid' : ''}`}
            onClick={() => setViewTrash(v => !v)}
            title="Inspect deleted leads and recover them"
          >
            <Icon name="trash" size={16} />
            {viewTrash ? 'Back to Pipeline' : `Trash (${syncStatus?.stats?.trashed_leads || 0})`}
          </button>

          <button type="button" className="btn solid lg" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} />
            New Lead / Client
          </button>
        </div>
      </PageHead>

      {/* Sync Status Banner */}
      {syncStatus?.config && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(255, 92, 0, 0.06)',
          border: '1px solid rgba(255, 92, 0, 0.2)',
          borderRadius: '10px',
          padding: '8px 14px',
          marginBottom: '16px',
          fontSize: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: syncStatus.config.configured ? '#22c55e' : '#f59e0b'
            }} />
            <span>
              <b>Google Sheets Two-Way CRM:</b> Sheet <code>{syncStatus.config.sheet_name}</code>
              {syncStatus.config.last_sync_at ? (
                <> · Last sync: {new Date(syncStatus.config.last_sync_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
              ) : ' · No sync performed yet'}
            </span>
          </div>

          <div style={{ color: 'var(--sub)' }}>
            Active: <b>{syncStatus.stats.active_leads}</b> | Trashed: <b>{syncStatus.stats.trashed_leads}</b>
          </div>
        </div>
      )}

      {/* Main View: Active Pipeline vs Trash */}
      {!viewTrash ? (
        <>
          <div className="kpis four" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '22px' }}>
            <Kpi
              icon="users"
              label="Total Active Leads"
              value={totalLeads}
              format={(n) => `${n} Leads`}
              note={`${qualifiedCount} Qualified`}
              tone="accent"
            />
            <Kpi
              icon="note"
              label="Proposals Sent"
              value={proposalCount}
              format={(n) => `${n} In Progress`}
              note="Active negotiations"
              tone="amber"
            />
            <Kpi
              icon="check"
              label="Deals Won"
              value={wonCount}
              format={(n) => `${n} Clients`}
              note="Closed &amp; accepted"
              tone="green"
            />
            <Kpi
              icon="coins"
              label="Estimated Pipeline"
              value={pipelineValue}
              format={(n) => `₹${n.toLocaleString('en-IN')}`}
              note="Total stated budget"
              tone="accent"
            />
          </div>

          <div className="contacts-toolbar rv" style={{ '--d': '120ms', '--i': 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', gap: '14px', flexWrap: 'wrap' }}>
            <Segmented
              items={LIFECYCLE_STAGES.map((s) => ({
                key: s.key,
                label: s.label,
                count: s.key === 'all' ? clients.length : clients.filter((c) => c.lifecycle_status === s.key).length
              }))}
              value={filter}
              onChange={setFilter}
            />
            <label className="search-box">
              <Icon name="search" size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, business..."
                aria-label="Search clients"
              />
            </label>
          </div>

          <div className="contact-grid" key={filter}>
            {filtered.length === 0 ? (
              <Empty icon="users" title="No leads or clients found" body="Try another search or filter, or click 'New Lead / Client'." />
            ) : null}

            {filtered.map((c, i) => {
              const colors = statusColor(c.lifecycle_status)
              return (
                <article key={c.id} className="card contact" style={{ '--d': `${160 + i * 45}ms`, position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <Persona name={c.name} hue={(c.id * 53) % 360} size={50} />
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {c.google_sheet_synced_at ? (
                        <span
                          title={`Synced with Google Sheets on ${new Date(c.google_sheet_synced_at).toLocaleString()}`}
                          style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(34, 197, 94, 0.1)',
                            color: '#16a34a',
                            fontWeight: 600
                          }}
                        >
                          Synced
                        </span>
                      ) : null}
                      <span
                        className="pill-tag"
                        style={{
                          textTransform: 'capitalize',
                          background: colors.bg,
                          color: colors.text,
                          fontWeight: 700,
                          fontSize: '11px'
                        }}
                      >
                        {c.lifecycle_status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>

                  <strong style={{ fontSize: '15px' }}>{c.name}</strong>
                  <small style={{ color: 'var(--sub)' }}>{c.business_name || c.industry || 'Lead'}</small>

                  {c.whatsapp_phone ? (
                    <p className="contact-bank" style={{ margin: '6px 0', fontSize: '12px' }}>
                      📱 +{c.whatsapp_phone}
                    </p>
                  ) : null}

                  {c.requirement ? (
                    <p style={{ fontSize: '12px', color: 'var(--sub)', margin: '4px 0 10px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {c.requirement}
                    </p>
                  ) : null}

                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '11.5px', color: 'var(--sub)', borderTop: '1px solid var(--line)', paddingTop: '8px', marginTop: 'auto' }}>
                    <span>Budget: {c.budget ? `₹${Number(c.budget).toLocaleString('en-IN')}` : 'TBD'}</span>
                    <span>{c.city || 'India'}</span>
                  </div>

                  <div className="contact-acts" style={{ marginTop: '10px', width: '100%', display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn solid tiny"
                      style={{ flex: 1 }}
                      onClick={() => openDetail(c)}
                    >
                      <Icon name="eye" size={14} />
                      Profile
                    </button>

                    <button
                      type="button"
                      className="btn tiny"
                      title="Edit Lead Details"
                      onClick={() => openEditModal(c)}
                    >
                      <Icon name="edit" size={14} />
                    </button>

                    <button
                      type="button"
                      className="btn tiny"
                      title="Create Quotation for Client"
                      onClick={() => go('quotations')}
                    >
                      <Icon name="receipt" size={14} />
                    </button>

                    {c.whatsapp_phone ? (
                      <button
                        type="button"
                        className="icon-btn soft sm"
                        title={`Open WhatsApp Chat for ${c.name}`}
                        onClick={() => go('messages')}
                      >
                        <Icon name="chat" size={15} />
                      </button>
                    ) : null}

                    <button
                      type="button"
                      className="btn tiny"
                      title="Move Lead to Trash"
                      onClick={() => setDeleteConfirm(c)}
                      style={{ color: '#ef4444' }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </>
      ) : (
        /* Trash / Bin View */
        <div style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0 }}>Trash &amp; Recoverable Leads</h3>
              <small style={{ color: 'var(--sub)' }}>
                Soft-deleted leads are preserved here. They will NOT be re-imported from Google Sheets during two-way sync.
              </small>
            </div>
            <button type="button" className="btn solid" onClick={() => setViewTrash(false)}>
              Back to Pipeline
            </button>
          </div>

          {filteredTrash.length === 0 ? (
            <Empty icon="trash" title="Trash is empty" body="No soft-deleted leads found." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filteredTrash.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--card)',
                    border: '1px solid var(--line)',
                    padding: '12px 18px',
                    borderRadius: '12px',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '15px' }}>{c.name}</strong>
                    <div style={{ fontSize: '12px', color: 'var(--sub)' }}>
                      {c.business_name} · 📱 +{c.whatsapp_phone} · Deleted on: {new Date(c.deleted_at).toLocaleDateString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn solid tiny"
                      onClick={() => handleRestore(c.id)}
                    >
                      <Icon name="check" size={14} />
                      Restore to Pipeline
                    </button>

                    <button
                      type="button"
                      className="btn tiny"
                      onClick={() => handlePermanentDelete(c.id)}
                      style={{ color: '#ef4444' }}
                    >
                      <Icon name="trash" size={14} />
                      Delete Permanently
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL: Delete Confirmation */}
      <Modal
        open={Boolean(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
        title="Move Lead to Trash?"
        sub={`Soft-delete "${deleteConfirm?.name}" from active CRM pipeline.`}
      >
        <p style={{ fontSize: '13px', color: 'var(--sub)', lineHeight: 1.6 }}>
          This lead will be moved to the recoverable Trash. It will not be removed from historical invoices or quotes, and two-way Google Sheets synchronization will recognize this lead as tombstoned so it won't be re-created automatically.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button type="button" className="btn" onClick={() => setDeleteConfirm(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn solid"
            style={{ background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}
            onClick={() => handleSoftDelete(deleteConfirm?.id)}
          >
            Confirm Soft Delete
          </button>
        </div>
      </Modal>

      {/* MODAL: Create New Lead / Client */}
      <Modal open={adding} onClose={() => setAdding(false)} title="New Lead / Client" sub="Add lead to CRM with WhatsApp number deduplication and automated timeline tracking.">
        <form className="form" onSubmit={handleCreateClient}>
          <div className="field-row">
            <label className="field">
              <span>Full Name *</span>
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Vikram Singhania"
                required
                autoFocus
              />
            </label>
            <label className="field">
              <span>WhatsApp Phone *</span>
              <input
                value={form.whatsapp_phone}
                onChange={(e) => setForm((prev) => ({ ...prev, whatsapp_phone: e.target.value }))}
                placeholder="+91 98765 43210"
                required
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Business / Company</span>
              <input
                value={form.business_name}
                onChange={(e) => setForm((prev) => ({ ...prev, business_name: e.target.value }))}
                placeholder="e.g. Singhania Logistics Ltd"
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="vikram@singhania.in"
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Industry</span>
              <input
                value={form.industry}
                onChange={(e) => setForm((prev) => ({ ...prev, industry: e.target.value }))}
                placeholder="e.g. E-Commerce / Retail"
              />
            </label>
            <label className="field">
              <span>City</span>
              <input
                value={form.city}
                onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
                placeholder="Mumbai"
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Language Preference</span>
              <select
                value={form.language}
                onChange={(e) => setForm((prev) => ({ ...prev, language: e.target.value }))}
              >
                <option value="English">English</option>
                <option value="Hindi">Hindi (हिंदी)</option>
                <option value="Hinglish">Hinglish</option>
                <option value="Marathi">Marathi (मराठी)</option>
              </select>
            </label>

            <label className="field">
              <span>Budget (INR)</span>
              <input
                type="number"
                min="0"
                value={form.budget}
                onChange={(e) => setForm((prev) => ({ ...prev, budget: e.target.value }))}
                placeholder="e.g. 50000"
              />
            </label>
          </div>

          <label className="field">
            <span>Client Requirement &amp; Scope</span>
            <textarea
              rows={2}
              value={form.requirement}
              onChange={(e) => setForm((prev) => ({ ...prev, requirement: e.target.value }))}
              placeholder="e.g. Looking for AI bot to handle 500 inquiries/day and sync leads into Google Sheets."
            />
          </label>

          <button type="submit" className="btn solid lg block" disabled={!form.name.trim()}>
            <Icon name="plus" size={17} />
            Save to CRM Pipeline
          </button>
        </form>
      </Modal>

      {/* MODAL: Edit Lead */}
      <Modal open={Boolean(editingClient)} onClose={() => setEditingClient(null)} title="Edit Lead / Client" sub={`Update CRM profile for ${editingClient?.name}`}>
        <form className="form" onSubmit={handleUpdateClient}>
          <div className="field-row">
            <label className="field">
              <span>Full Name *</span>
              <input
                value={editForm.name || ''}
                onChange={(e) => setEditForm(p => ({ ...p, name: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>WhatsApp Phone</span>
              <input
                value={editForm.whatsapp_phone || ''}
                onChange={(e) => setEditForm(p => ({ ...p, whatsapp_phone: e.target.value }))}
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Company</span>
              <input
                value={editForm.business_name || ''}
                onChange={(e) => setEditForm(p => ({ ...p, business_name: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={editForm.email || ''}
                onChange={(e) => setEditForm(p => ({ ...p, email: e.target.value }))}
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Budget (INR)</span>
              <input
                type="number"
                value={editForm.budget || ''}
                onChange={(e) => setEditForm(p => ({ ...p, budget: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Pipeline Stage</span>
              <select
                value={editForm.lifecycle_status || 'new_lead'}
                onChange={(e) => setEditForm(p => ({ ...p, lifecycle_status: e.target.value }))}
              >
                <option value="new_lead">New Lead</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
                <option value="proposal_sent">Proposal Sent</option>
                <option value="negotiation">Negotiation</option>
                <option value="won">Won / Closed</option>
                <option value="lost">Lost</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Requirement</span>
            <textarea
              rows={2}
              value={editForm.requirement || ''}
              onChange={(e) => setEditForm(p => ({ ...p, requirement: e.target.value }))}
            />
          </label>

          <button type="submit" className="btn solid lg block" disabled={!editForm.name?.trim()}>
            Save Changes
          </button>
        </form>
      </Modal>

      {/* MODAL: Client Detail & Timeline Drawer */}
      <Modal
        open={Boolean(activeClient)}
        onClose={() => {
          setActiveClient(null)
          setDetailData(null)
        }}
        title={detailData ? `${detailData.name} — CRM Record` : 'Client Profile'}
        sub={detailData?.business_name || 'Agency Lead Detail'}
      >
        {detailData ? (
          <div>
            {/* Quick Status Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--soft)', padding: '12px 16px', borderRadius: '12px', marginBottom: '16px' }}>
              <div>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--sub)', fontWeight: 700 }}>Current Stage</span>
                <div style={{ fontSize: '14px', fontWeight: 800, textTransform: 'capitalize' }}>
                  {detailData.lifecycle_status.replace('_', ' ')}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  value={detailData.lifecycle_status}
                  onChange={(e) => updateStatus(detailData.id, e.target.value)}
                  style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '8px' }}
                >
                  <option value="new_lead">New Lead</option>
                  <option value="contacted">Contacted</option>
                  <option value="qualified">Qualified</option>
                  <option value="proposal_sent">Proposal Sent</option>
                  <option value="negotiation">Negotiation</option>
                  <option value="won">Won / Closed</option>
                  <option value="lost">Lost</option>
                </select>

                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => openEditModal(detailData)}
                >
                  <Icon name="edit" size={14} /> Edit
                </button>

                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => {
                    setActiveClient(null)
                    go('quotations')
                  }}
                >
                  <Icon name="receipt" size={14} /> Quote
                </button>
              </div>
            </div>

            {/* Contact Specs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '12.5px', marginBottom: '18px' }}>
              <div>
                <span style={{ color: 'var(--sub)' }}>WhatsApp:</span> <b>+{detailData.whatsapp_phone}</b>
              </div>
              <div>
                <span style={{ color: 'var(--sub)' }}>Email:</span> <b>{detailData.email || '—'}</b>
              </div>
              <div>
                <span style={{ color: 'var(--sub)' }}>City / Country:</span> <b>{detailData.city || 'India'}</b>
              </div>
              <div>
                <span style={{ color: 'var(--sub)' }}>TBW UUID:</span> <code style={{ fontSize: '11px' }}>{detailData._tbw_id ? `${detailData._tbw_id.substring(0, 8)}...` : 'Assigned'}</code>
              </div>
            </div>

            {/* Quotations History */}
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Quotations ({(detailData.quotations || []).length})</div>
              {(detailData.quotations || []).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {detailData.quotations.map((q) => (
                    <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card)', border: '1px solid var(--line)', padding: '8px 12px', borderRadius: '10px', fontSize: '12px' }}>
                      <div>
                        <b>{q.quotation_number}</b> · <span style={{ textTransform: 'capitalize', color: 'var(--sub)' }}>{q.status}</span>
                      </div>
                      <a
                        href={`${api.getBaseUrl()}/api/quotations/${q.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn tiny"
                        style={{ textDecoration: 'none' }}
                      >
                        <Icon name="download" size={12} /> PDF
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <small style={{ color: 'var(--sub)' }}>No quotations created yet for this client.</small>
              )}
            </div>

            {/* Internal Notes Feed */}
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Internal Notes</div>
              <form onSubmit={handleAddNote} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add internal discussion note..."
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn solid tiny" disabled={savingNote || !newNote.trim()}>
                  Post Note
                </button>
              </form>

              <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(detailData.notes || []).map((n) => (
                  <div key={n.id} style={{ background: 'var(--soft)', padding: '8px 12px', borderRadius: '8px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--sub)', fontSize: '10.5px', marginBottom: '2px' }}>
                      <b>{n.author_name || 'Team Member'}</b>
                      <span>{new Date(n.created_at).toLocaleDateString()}</span>
                    </div>
                    <div>{n.content}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Lead Events Timeline */}
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Activity Timeline</div>
              <div style={{ maxHeight: '130px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(detailData.events || []).map((e) => (
                  <div key={e.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11.5px', color: 'var(--sub)' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{e.description || e.event_type}</span>
                    <small>{new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                  </div>
                ))}
              </div>
            </div>

            {/* Drawer Actions */}
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn tiny"
                style={{ color: '#ef4444' }}
                onClick={() => setDeleteConfirm(detailData)}
              >
                <Icon name="trash" size={14} /> Move to Trash
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
