import { useState, useEffect } from 'react'
import Icon from '../components/Icon'
import { Empty, Kpi, Modal, PageHead, Segmented } from '../components/ui'
import { useApp } from '../lib/store'
import { money } from '../lib/format'
import { api } from '../lib/api'

const PACKAGES = [
  {
    id: 'wa-ai-basic',
    name: 'WhatsApp AI Agent Setup',
    scope: 'Deploy 4-language WhatsApp Cloud API AI bot, n8n automated lead capture, and CRM sync.',
    deliverables: '1. n8n workflow deployment\n2. Meta WhatsApp Cloud webhook integration\n3. TBW Dashboard CRM integration\n4. Staff training session',
    timeline: '10-14 Working Days',
    milestones: '50% advance upfront, 50% upon deployment & UAT sign-off',
    items: [
      { description: 'WhatsApp AI Agent Architecture & n8n Workflow Setup', quantity: 1, setup_fee: 45000, monthly_fee: 0 },
      { description: 'Monthly Managed AI Bot Maintenance & SLA Support', quantity: 1, setup_fee: 0, monthly_fee: 6500 }
    ]
  },
  {
    id: 'wa-multi-agent',
    name: 'Multi-Language WhatsApp Bot + n8n Workflow',
    scope: 'Full-stack AI automation with Google Sheets sync, interactive buttons, Human takeover guard, and Gemini integration.',
    deliverables: '1. Multi-language intent classifier\n2. Dual-mode routing (AI / Human takeover)\n3. Google Sheets lead capture integration\n4. WhatsApp interactive list menus\n5. 30 days hypercare support',
    timeline: '14-21 Working Days',
    milestones: '40% advance, 30% on staging delivery, 30% upon go-live',
    items: [
      { description: 'WhatsApp Cloud API Enterprise Bot & Gemini Integration', quantity: 1, setup_fee: 55000, monthly_fee: 0 },
      { description: 'Interactive List Menus & Google Sheets Database Sync', quantity: 1, setup_fee: 20000, monthly_fee: 0 },
      { description: 'Monthly Cloud Infrastructure & SLA Maintenance', quantity: 1, setup_fee: 0, monthly_fee: 8500 }
    ]
  },
  {
    id: 'crm-automation',
    name: 'Custom CRM & Lead Automation Pipeline',
    scope: 'Comprehensive agency operating system with real-time lead capture, quotation automation, and multi-agent dispatch.',
    deliverables: '1. SQLite WAL business database setup\n2. Real-time SSE inbox with human takeover\n3. Quotation & Invoice automated generation\n4. Role-based team dashboard',
    timeline: '3-4 Weeks',
    milestones: '50% advance, 50% upon final acceptance',
    items: [
      { description: 'Complete Business OS & Custom CRM Deployment', quantity: 1, setup_fee: 85000, monthly_fee: 0 },
      { description: 'Quotation Engine & WhatsApp Automation Connectors', quantity: 1, setup_fee: 25000, monthly_fee: 0 },
      { description: 'Monthly Premium Retainer & Enterprise SLA', quantity: 1, setup_fee: 0, monthly_fee: 12000 }
    ]
  }
]

export default function Quotations() {
  const { toast, go } = useApp()
  const [quotations, setQuotations] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [selId, setSelId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [converting, setConverting] = useState(false)

  // Form State for Quotation Builder
  const [form, setForm] = useState({
    client_id: '',
    package_type: PACKAGES[0].name,
    scope_of_work: PACKAGES[0].scope,
    deliverables: PACKAGES[0].deliverables,
    timeline: PACKAGES[0].timeline,
    payment_milestones: PACKAGES[0].milestones,
    terms: 'Quotation valid for 14 days from issue date. Meta messaging charges billed at actuals.',
    discount_type: 'none',
    discount_value: 0,
    tax_type: 'none',
    tax_rate: 0,
    items: PACKAGES[0].items.map((it) => ({ ...it }))
  })

  // Load Quotations and Clients from API
  const loadData = async () => {
    try {
      setLoading(true)
      const [quoteRes, clientRes] = await Promise.all([
        api.get('/api/quotations').catch(() => ({ data: [] })),
        api.get('/api/clients?limit=100').catch(() => ({ data: { items: [] } }))
      ])

      const list = quoteRes.data || []
      setQuotations(list)
      if (list.length > 0 && !selId) {
        setSelId(list[0].id)
      }

      const clientList = clientRes.data?.items || []
      setClients(clientList)
      if (clientList.length > 0 && !form.client_id) {
        setForm((prev) => ({ ...prev, client_id: String(clientList[0].id) }))
      }
    } catch (err) {
      console.error('Failed to load quotations:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const selectedQuote = quotations.find((q) => q.id === selId) || quotations[0]

  // Filtered list
  const shown = quotations.filter((q) => {
    if (filter === 'all') return true
    return q.status === filter
  })

  // Calculate live summary in Quotation Builder
  const formSetupSubtotal = form.items.reduce((sum, it) => sum + (Number(it.setup_fee) || 0) * (Number(it.quantity) || 1), 0)
  const formMonthlySubtotal = form.items.reduce((sum, it) => sum + (Number(it.monthly_fee) || 0) * (Number(it.quantity) || 1), 0)

  let formDiscountAmount = 0
  if (form.discount_type === 'percentage') {
    formDiscountAmount = Math.round((formSetupSubtotal * (Number(form.discount_value) || 0)) / 100)
  } else if (form.discount_type === 'fixed') {
    formDiscountAmount = Number(form.discount_value) || 0
  }

  const formTaxableSetup = Math.max(0, formSetupSubtotal - formDiscountAmount)
  const formNetSetupTotal = formTaxableSetup

  // Handle Preset Package Switch
  const applyPackagePreset = (pkgId) => {
    const pkg = PACKAGES.find((p) => p.id === pkgId)
    if (!pkg) return
    setForm((prev) => ({
      ...prev,
      package_type: pkg.name,
      scope_of_work: pkg.scope,
      deliverables: pkg.deliverables,
      timeline: pkg.timeline,
      payment_milestones: pkg.milestones,
      items: pkg.items.map((it) => ({ ...it }))
    }))
  }

  // Create Quotation Submit
  const handleCreateQuotation = async (e) => {
    e.preventDefault()
    if (!form.client_id) {
      toast('Select Client', 'Please choose a client for this quotation.', { icon: 'info' })
      return
    }

    try {
      const payload = {
        ...form,
        client_id: Number(form.client_id),
        discount_type: form.discount_type === 'none' ? null : form.discount_type,
        discount_value: Number(form.discount_value) || 0,
        tax_type: 'none',
        tax_rate: 0,
        items: form.items.map((it) => ({
          ...it,
          quantity: Number(it.quantity) || 1,
          setup_fee: Number(it.setup_fee) || 0,
          monthly_fee: Number(it.monthly_fee) || 0
        }))
      }

      const res = await api.post('/api/quotations', payload)
      if (res.success) {
        toast('Quotation Created', `Quotation ${res.data.quotation_number} generated successfully.`, { icon: 'check' })
        setCreating(false)
        await loadData()
        setSelId(res.data.id)
      }
    } catch (err) {
      toast('Error', err.message || 'Failed to create quotation', { icon: 'close' })
    }
  }

  // Convert to Invoice & Project
  const handleConvert = async (quote) => {
    if (!quote || converting) return
    try {
      setConverting(true)
      const res = await api.post(`/api/quotations/${quote.id}/convert`, {})
      if (res.success) {
        toast('Converted to Invoice', `Invoice ${res.data.invoiceNumber} and Project created!`, { icon: 'check' })
        await loadData()
      }
    } catch (err) {
      toast('Conversion Failed', err.message || 'Could not convert quotation', { icon: 'close' })
    } finally {
      setConverting(false)
    }
  }

  // Copy WhatsApp Pitch & Acceptance Link
  const handleCopyWhatsAppLink = (quote) => {
    if (!quote) return
    const baseUrl = window.location.origin
    const acceptLink = `${api.getBaseUrl()}/api/quotations/accept/${quote.acceptance_token}`
    const msg = `Hello ${quote.client_name || 'Client'},

Thank you for connecting with *The Business Work*.

Here is our official quotation *${quote.quotation_number}* for:
*${quote.package_type || 'Custom Automation Solution'}*

💼 *Commercial Summary:*
• Setup / One-time Fee: ₹${(quote.total_setup_fee || 0).toLocaleString('en-IN')}
• Monthly Maintenance: ₹${(quote.total_monthly_fee || 0).toLocaleString('en-IN')}/mo

📄 *Review & Accept Digitally:*
${acceptLink}

📥 You can also download the official PDF directly from the dashboard. Let us know if you have any questions!`

    navigator.clipboard.writeText(msg)
    toast('WhatsApp Message Copied', 'Paste into WhatsApp or click send to open chat.', { icon: 'copy' })

    if (quote.client_phone) {
      const waUrl = `https://wa.me/${quote.client_phone}?text=${encodeURIComponent(msg)}`
      window.open(waUrl, '_blank')
    }
  }

  // KPI Calculations
  const totalCount = quotations.length
  const totalSetupValue = quotations.reduce((acc, q) => acc + (Number(q.total_setup_fee) || 0), 0)
  const totalRecurringValue = quotations.reduce((acc, q) => acc + (Number(q.total_monthly_fee) || 0), 0)
  const acceptedCount = quotations.filter((q) => q.status === 'accepted' || q.status === 'converted').length
  const acceptRate = totalCount > 0 ? Math.round((acceptedCount / totalCount) * 100) : 0

  return (
    <>
      <PageHead
        title="Quotation Builder"
        sub="Create official INR quotations with service packages, recurring fees, and instant WhatsApp digital sign-off."
      >
        <button type="button" className="btn solid lg" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} />
          New Quotation
        </button>
      </PageHead>

      <div className="kpis four" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '22px' }}>
        <Kpi
          icon="receipt"
          label="Total Quotations"
          value={totalCount}
          format={(n) => `${n} Quotes`}
          note={`${acceptedCount} Accepted / Converted`}
          tone="accent"
        />
        <Kpi
          icon="coins"
          label="Setup Pipeline Value"
          value={totalSetupValue}
          format={(n) => `₹${n.toLocaleString('en-IN')}`}
          note="Total one-time fees"
          tone="green"
        />
        <Kpi
          icon="layers"
          label="Recurring Monthly"
          value={totalRecurringValue}
          format={(n) => `₹${n.toLocaleString('en-IN')}/mo`}
          note="Retainer revenue"
          tone="amber"
        />
        <Kpi
          icon="check"
          label="Acceptance Rate"
          value={acceptRate}
          format={(n) => `${n}%`}
          note="Client win ratio"
          tone="green"
        />
      </div>

      <div className="invoice-grid">
        {/* Left column: List of Quotations */}
        <section className="card invoice-list-card" style={{ '--d': '200ms' }}>
          <div className="section-head rv" style={{ '--i': 0, marginBottom: '16px' }}>
            <Segmented
              items={[
                { key: 'all', label: 'All', count: quotations.length },
                { key: 'draft', label: 'Draft', count: quotations.filter((q) => q.status === 'draft').length },
                { key: 'sent', label: 'Sent', count: quotations.filter((q) => q.status === 'sent').length },
                { key: 'accepted', label: 'Accepted', count: quotations.filter((q) => q.status === 'accepted').length },
                { key: 'converted', label: 'Converted', count: quotations.filter((q) => q.status === 'converted').length }
              ]}
              value={filter}
              onChange={setFilter}
            />
          </div>

          <div className="inv-rows">
            {shown.length === 0 ? (
              <Empty icon="receipt" title="No quotations found" body="Create a new quote to start closing deals." />
            ) : null}

            {shown.map((q, i) => (
              <button
                key={q.id}
                type="button"
                className={`inv-row ${selectedQuote?.id === q.id ? 'on' : ''}`}
                style={{ '--i': i }}
                onClick={() => setSelId(q.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: 'var(--soft)' }}>
                  <Icon name="receipt" size={18} />
                </div>
                <div>
                  <strong style={{ display: 'block', fontSize: '13.5px' }}>{q.quotation_number}</strong>
                  <small style={{ color: 'var(--sub)', fontSize: '12px' }}>{q.client_name} · {q.business_name || 'Client'}</small>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <b style={{ display: 'block', fontSize: '13.5px' }}>₹{(q.total_setup_fee || 0).toLocaleString('en-IN')}</b>
                  {q.total_monthly_fee > 0 ? (
                    <small style={{ color: 'var(--accent)', fontSize: '11px' }}>+₹{q.total_monthly_fee.toLocaleString('en-IN')}/mo</small>
                  ) : null}
                </div>
                <span
                  className="pill-tag"
                  style={{
                    textTransform: 'capitalize',
                    background: q.status === 'accepted' ? 'rgba(34, 197, 94, 0.15)' : q.status === 'sent' ? 'rgba(245, 158, 11, 0.15)' : 'var(--soft)',
                    color: q.status === 'accepted' ? '#16a34a' : q.status === 'sent' ? '#d97706' : 'var(--ink)'
                  }}
                >
                  {q.status}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Right column: Document Preview and Actions */}
        <section className="card invoice-preview" style={{ '--d': '260ms' }}>
          {selectedQuote ? (
            <div className="paper">
              {selectedQuote.status === 'accepted' ? (
                <div className="paid-stamp" style={{ borderColor: 'var(--green)', color: 'var(--green)' }}>
                  ACCEPTED
                </div>
              ) : null}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '18px' }}>
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: 800, margin: 0, letterSpacing: '-0.3px' }}>THE BUSINESS WORK</h3>
                  <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--sub)' }}>We Make Business Simpler.</p>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--sub)' }}>hello@thebusinesswork.com</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="pill-tag" style={{ background: 'var(--accent)', color: '#fff', fontWeight: 700, padding: '4px 10px', fontSize: '11px' }}>
                    OFFICIAL QUOTATION
                  </span>
                  <div style={{ marginTop: '8px', fontSize: '12px' }}>
                    <b>Quote #:</b> {selectedQuote.quotation_number}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--sub)' }}>
                    <b>Date:</b> {new Date(selectedQuote.created_at).toLocaleDateString('en-IN')}
                  </div>
                  {selectedQuote.valid_until ? (
                    <div style={{ fontSize: '12px', color: 'var(--sub)' }}>
                      <b>Valid Until:</b> {new Date(selectedQuote.valid_until).toLocaleDateString('en-IN')}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Client & Scope */}
              <div style={{ marginBottom: '16px' }}>
                <small style={{ textTransform: 'uppercase', color: 'var(--sub)', fontWeight: 700, fontSize: '10.5px' }}>PREPARED FOR</small>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)' }}>{selectedQuote.client_name}</div>
                {selectedQuote.business_name ? <div style={{ fontSize: '13px', color: 'var(--sub)' }}>{selectedQuote.business_name}</div> : null}
                {selectedQuote.client_phone ? <div style={{ fontSize: '12px', color: 'var(--sub)' }}>Phone: +{selectedQuote.client_phone}</div> : null}
              </div>

              <div style={{ background: 'var(--soft)', padding: '12px 14px', borderRadius: '12px', marginBottom: '18px' }}>
                <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>Package: {selectedQuote.package_type}</div>
                {selectedQuote.scope_of_work ? (
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--sub)', lineHeight: 1.4 }}>{selectedQuote.scope_of_work}</p>
                ) : null}
              </div>

              {/* Items Breakdown */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 50px 100px 100px', fontWeight: 700, fontSize: '11px', color: 'var(--sub)', paddingBottom: '6px', borderBottom: '1.5px solid var(--line)' }}>
                  <span>ITEM / DESCRIPTION</span>
                  <span style={{ textAlign: 'center' }}>QTY</span>
                  <span style={{ textAlign: 'right' }}>SETUP (₹)</span>
                  <span style={{ textAlign: 'right' }}>MONTHLY (₹)</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px' }}>
                  {(selectedQuote.items || []).length > 0 ? (
                    selectedQuote.items.map((it, idx) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 50px 100px 100px', fontSize: '12.5px', alignItems: 'center' }}>
                        <span>{it.description}</span>
                        <span style={{ textAlign: 'center', color: 'var(--sub)' }}>{it.quantity}</span>
                        <span style={{ textAlign: 'right', fontWeight: 600 }}>₹{((it.setup_fee || 0) * (it.quantity || 1)).toLocaleString('en-IN')}</span>
                        <span style={{ textAlign: 'right', color: 'var(--accent)' }}>
                          {it.monthly_fee > 0 ? `₹${((it.monthly_fee || 0) * (it.quantity || 1)).toLocaleString('en-IN')}/mo` : '—'}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 50px 100px 100px', fontSize: '12.5px', alignItems: 'center' }}>
                      <span>{selectedQuote.package_type}</span>
                      <span style={{ textAlign: 'center', color: 'var(--sub)' }}>1</span>
                      <span style={{ textAlign: 'right', fontWeight: 600 }}>₹{(selectedQuote.total_setup_fee || 0).toLocaleString('en-IN')}</span>
                      <span style={{ textAlign: 'right', color: 'var(--accent)' }}>
                        {selectedQuote.total_monthly_fee > 0 ? `₹${selectedQuote.total_monthly_fee.toLocaleString('en-IN')}/mo` : '—'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Totals Summary Box */}
              <div style={{ marginLeft: 'auto', width: '280px', background: 'var(--soft)', padding: '12px 16px', borderRadius: '12px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--sub)' }}>Setup Subtotal:</span>
                  <b>₹{(selectedQuote.total_setup_fee || 0).toLocaleString('en-IN')}</b>
                </div>

                {selectedQuote.discount_value > 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px', color: 'var(--green)' }}>
                    <span>Discount:</span>
                    <b>- ₹{Number(selectedQuote.discount_value).toLocaleString('en-IN')}</b>
                  </div>
                ) : null}

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 800, borderTop: '1px solid var(--line)', paddingTop: '6px' }}>
                  <span>One-Time Due:</span>
                  <span style={{ color: 'var(--ink)' }}>
                    ₹{Number(selectedQuote.total_setup_fee || 0).toLocaleString('en-IN')}
                  </span>
                </div>

                {selectedQuote.total_monthly_fee > 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, marginTop: '6px', color: 'var(--accent)' }}>
                    <span>Recurring Monthly:</span>
                    <span>₹{selectedQuote.total_monthly_fee.toLocaleString('en-IN')}/mo</span>
                  </div>
                ) : null}
              </div>

              {/* Action Toolbar */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                <a
                  href={`${api.getBaseUrl()}/api/quotations/${selectedQuote.id}/pdf${localStorage.getItem('tbw_token') ? `?token=${encodeURIComponent(localStorage.getItem('tbw_token'))}` : ''}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn solid"
                  style={{ textDecoration: 'none' }}
                >
                  <Icon name="download" size={16} />
                  Download Official PDF
                </a>

                <button
                  type="button"
                  className="btn"
                  onClick={() => handleCopyWhatsAppLink(selectedQuote)}
                >
                  <Icon name="chat" size={16} />
                  Share via WhatsApp
                </button>

                {selectedQuote.status === 'accepted' ? (
                  <button
                    type="button"
                    className="btn solid"
                    style={{ background: 'var(--green)', borderColor: 'var(--green)' }}
                    disabled={converting}
                    onClick={() => handleConvert(selectedQuote)}
                  >
                    <Icon name="check" size={16} />
                    {converting ? 'Converting...' : 'Convert to Invoice & Project'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <Empty icon="receipt" title="Select a quotation" body="Choose a quotation from the left to view document details." />
          )}
        </section>
      </div>

      {/* MODAL: Quotation Builder Form */}
      <Modal open={creating} onClose={() => setCreating(false)} title="Create Quotation" sub="Configure real INR proposal with one-time setup and monthly retainer.">
        <form className="form" onSubmit={handleCreateQuotation}>
          <div className="field-row">
            <label className="field">
              <span>Client / Lead *</span>
              <select
                value={form.client_id}
                onChange={(e) => setForm((prev) => ({ ...prev, client_id: e.target.value }))}
                required
              >
                <option value="">Select a Client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.business_name ? `(${c.business_name})` : ''} - {c.whatsapp_phone || 'No phone'}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Preset Service Package</span>
              <select onChange={(e) => applyPackagePreset(e.target.value)}>
                {PACKAGES.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value="custom">Custom Configuration</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Package Name / Solution Title</span>
            <input
              value={form.package_type}
              onChange={(e) => setForm((prev) => ({ ...prev, package_type: e.target.value }))}
              placeholder="e.g. WhatsApp AI Agent Setup"
              required
            />
          </label>

          <label className="field">
            <span>Scope of Work</span>
            <textarea
              rows={2}
              value={form.scope_of_work}
              onChange={(e) => setForm((prev) => ({ ...prev, scope_of_work: e.target.value }))}
              placeholder="Summary of services and scope..."
            />
          </label>

          {/* Line Items Builder */}
          <div style={{ marginTop: '12px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>Line Items Breakdown</span>
              <button
                type="button"
                className="btn tiny"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    items: [...prev.items, { description: 'New Service Item', quantity: 1, setup_fee: 10000, monthly_fee: 0 }]
                  }))
                }
              >
                <Icon name="plus" size={14} /> Add Line Item
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {form.items.map((it, idx) => (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 60px 110px 110px 32px', gap: '8px', alignItems: 'center' }}>
                  <input
                    value={it.description}
                    placeholder="Description"
                    onChange={(e) => {
                      const val = e.target.value
                      setForm((prev) => {
                        const next = [...prev.items]
                        next[idx].description = val
                        return { ...prev, items: next }
                      })
                    }}
                  />
                  <input
                    type="number"
                    min="1"
                    value={it.quantity}
                    placeholder="Qty"
                    onChange={(e) => {
                      const val = Number(e.target.value) || 1
                      setForm((prev) => {
                        const next = [...prev.items]
                        next[idx].quantity = val
                        return { ...prev, items: next }
                      })
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    value={it.setup_fee}
                    placeholder="Setup (₹)"
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0
                      setForm((prev) => {
                        const next = [...prev.items]
                        next[idx].setup_fee = val
                        return { ...prev, items: next }
                      })
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    value={it.monthly_fee}
                    placeholder="Monthly (₹)"
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0
                      setForm((prev) => {
                        const next = [...prev.items]
                        next[idx].monthly_fee = val
                        return { ...prev, items: next }
                      })
                    }}
                  />
                  {form.items.length > 1 ? (
                    <button
                      type="button"
                      className="icon-btn soft sm"
                      onClick={() => setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  ) : <div />}
                </div>
              ))}
            </div>
          </div>

          {/* Discount Controls */}
          <div style={{ marginTop: '14px' }}>
            <label className="field">
              <span>Discount</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  value={form.discount_type}
                  onChange={(e) => setForm((prev) => ({ ...prev, discount_type: e.target.value }))}
                  style={{ width: '130px' }}
                >
                  <option value="none">No Discount</option>
                  <option value="fixed">Fixed (₹)</option>
                  <option value="percentage">Percent (%)</option>
                </select>
                {form.discount_type !== 'none' ? (
                  <input
                    type="number"
                    min="0"
                    value={form.discount_value}
                    onChange={(e) => setForm((prev) => ({ ...prev, discount_value: e.target.value }))}
                    placeholder="Value"
                  />
                ) : null}
              </div>
            </label>
          </div>

          {/* Live Preview Box */}
          <div style={{ background: 'var(--soft)', padding: '12px 16px', borderRadius: '12px', margin: '14px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
              <span>One-Time Setup Subtotal:</span>
              <b>₹{formSetupSubtotal.toLocaleString('en-IN')}</b>
            </div>
            {formDiscountAmount > 0 ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px', color: 'var(--green)' }}>
                <span>Discount:</span>
                <b>- ₹{formDiscountAmount.toLocaleString('en-IN')}</b>
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 800, borderTop: '1px solid var(--line)', paddingTop: '6px' }}>
              <span>Total Setup Due:</span>
              <span style={{ color: 'var(--ink)' }}>₹{formNetSetupTotal.toLocaleString('en-IN')}</span>
            </div>
            {formMonthlySubtotal > 0 ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, marginTop: '6px', color: 'var(--accent)' }}>
                <span>Recurring Monthly Maintenance:</span>
                <span>₹{formMonthlySubtotal.toLocaleString('en-IN')}/mo</span>
              </div>
            ) : null}
          </div>

          <button type="submit" className="btn solid lg block">
            <Icon name="check" size={18} />
            Generate &amp; Save Quotation
          </button>
        </form>
      </Modal>
    </>
  )
}
