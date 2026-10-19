import { useState, useEffect } from 'react'
import Icon from '../components/Icon'
import { Empty, Kpi, Modal, PageHead, Segmented } from '../components/ui'
import { useApp } from '../lib/store'
import { api } from '../lib/api'

export default function Invoices() {
  const { toast } = useApp()
  const [invoices, setInvoices] = useState([])
  const [clients, setClients] = useState([])
  const [payments, setPayments] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('invoices')
  const [filter, setFilter] = useState('all')
  const [selId, setSelId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [paying, setPaying] = useState(false)

  // New Invoice Form
  const [form, setForm] = useState({
    client_id: '',
    tax_type: 'none',
    tax_rate: 0,
    discount_type: 'none',
    discount_value: 0,
    due_date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    terms: 'Payment due within 14 days of issue date.',
    items: [{ description: 'Automation Solution Setup', quantity: 1, unit_price: 45000 }]
  })

  // Payment Form
  const [payForm, setPayForm] = useState({
    amount: '',
    method: 'upi',
    reference_id: '',
    payment_date: new Date().toISOString().split('T')[0],
    notes: ''
  })

  const loadData = async () => {
    try {
      setLoading(true)
      const [invRes, clientRes, payRes, subRes] = await Promise.all([
        api.get('/api/invoices').catch(() => ({ data: [] })),
        api.get('/api/clients?limit=100').catch(() => ({ data: { items: [] } })),
        api.get('/api/payments').catch(() => ({ data: [] })),
        api.get('/api/subscriptions').catch(() => ({ data: { items: [] } }))
      ])

      const invList = invRes.data || []
      setInvoices(invList)
      if (invList.length > 0 && !selId) {
        setSelId(invList[0].id)
      }

      const clientList = clientRes.data?.items || []
      setClients(clientList)
      if (clientList.length > 0 && !form.client_id) {
        setForm((prev) => ({ ...prev, client_id: String(clientList[0].id) }))
      }

      setPayments(payRes.data || [])
      setSubscriptions(subRes.data?.items || [])
    } catch (err) {
      console.error('Failed to load finance data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const selectedInvoice = invoices.find((i) => i.id === selId) || invoices[0]

  // Filtered invoices
  const shownInvoices = invoices.filter((i) => {
    if (filter === 'all') return true
    return i.status === filter
  })

  // KPIs
  const totalInvoiced = invoices.reduce((s, i) => s + (Number(i.total) || 0), 0)
  const totalPaid = invoices.reduce((s, i) => s + (Number(i.amount_paid) || 0), 0)
  const totalOutstanding = invoices.reduce((s, i) => s + (Number(i.balance_due) || 0), 0)
  const overdueCount = invoices.filter((i) => i.status === 'overdue').length

  // Create Invoice Submit
  const handleCreateInvoice = async (e) => {
    e.preventDefault()
    if (!form.client_id) {
      toast('Select Client', 'Please choose a client for this invoice.', { icon: 'info' })
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
          description: it.description,
          quantity: Number(it.quantity) || 1,
          unit_price: Number(it.unit_price) || 0
        }))
      }

      const res = await api.post('/api/invoices', payload)
      if (res.success) {
        toast('Invoice Created', `Invoice ${res.data.invoice_number} generated.`, { icon: 'check' })
        setCreating(false)
        await loadData()
        setSelId(res.data.id)
      }
    } catch (err) {
      toast('Error', err.message || 'Failed to create invoice', { icon: 'close' })
    }
  }

  // Record Payment Submit
  const handleRecordPayment = async (e) => {
    e.preventDefault()
    if (!selectedInvoice) return

    try {
      const payload = {
        invoice_id: selectedInvoice.id,
        client_id: selectedInvoice.client_id,
        amount: Number(payForm.amount),
        method: payForm.method,
        reference_id: payForm.reference_id || null,
        payment_date: payForm.payment_date,
        notes: payForm.notes
      }

      const res = await api.post('/api/payments', payload)
      if (res.success) {
        toast('Payment Recorded', `Receipt ${res.data.receipt_number} issued.`, { icon: 'check' })
        setPaying(false)
        setPayForm({
          amount: '',
          method: 'upi',
          reference_id: '',
          payment_date: new Date().toISOString().split('T')[0],
          notes: ''
        })
        await loadData()
      }
    } catch (err) {
      toast('Payment Error', err.message, { icon: 'close' })
    }
  }

  // Send Reminder
  const handleSendReminder = async (invoice) => {
    if (!invoice) return
    try {
      await api.post(`/api/invoices/${invoice.id}/remind`, {})
      toast('Reminder Recorded', `Payment reminder logged for ${invoice.invoice_number}`, { icon: 'bell' })
    } catch (err) {
      toast('Error', err.message, { icon: 'close' })
    }
  }

  return (
    <>
      <PageHead
        title="Finance &amp; Invoices"
        sub="INR billing, payment receipts, subscriptions, and partial payment tracking."
      >
        <button type="button" className="btn solid lg" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} />
          New Invoice
        </button>
      </PageHead>

      <div className="kpis four" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '22px' }}>
        <Kpi
          icon="coins"
          label="Total Collected"
          value={totalPaid}
          format={(n) => `₹${n.toLocaleString('en-IN')}`}
          note="Confirmed revenue"
          tone="green"
        />
        <Kpi
          icon="clock"
          label="Outstanding Balance"
          value={totalOutstanding}
          format={(n) => `₹${n.toLocaleString('en-IN')}`}
          note="Pending collections"
          tone="amber"
        />
        <Kpi
          icon="receipt"
          label="Total Invoiced"
          value={totalInvoiced}
          format={(n) => `₹${n.toLocaleString('en-IN')}`}
          note={`${invoices.length} Invoices`}
          tone="accent"
        />
        <Kpi
          icon="info"
          label="Overdue Invoices"
          value={overdueCount}
          format={(n) => `${n} Overdue`}
          note="Action required"
          tone="accent"
        />
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
        <button
          type="button"
          className={`chip ${tab === 'invoices' ? 'on' : ''}`}
          onClick={() => setTab('invoices')}
        >
          <Icon name="receipt" size={16} /> Invoices ({invoices.length})
        </button>
        <button
          type="button"
          className={`chip ${tab === 'payments' ? 'on' : ''}`}
          onClick={() => setTab('payments')}
        >
          <Icon name="check" size={16} /> Payment Receipts ({payments.length})
        </button>
        <button
          type="button"
          className={`chip ${tab === 'subscriptions' ? 'on' : ''}`}
          onClick={() => setTab('subscriptions')}
        >
          <Icon name="layers" size={16} /> Recurring Subscriptions ({subscriptions.length})
        </button>
      </div>

      {tab === 'invoices' && (
        <div className="invoice-grid">
          {/* Invoices List */}
          <section className="card invoice-list-card" style={{ '--d': '200ms' }}>
            <div className="section-head rv" style={{ '--i': 0, marginBottom: '16px' }}>
              <Segmented
                items={[
                  { key: 'all', label: 'All', count: invoices.length },
                  { key: 'paid', label: 'Paid', count: invoices.filter((i) => i.status === 'paid').length },
                  { key: 'partially_paid', label: 'Partial', count: invoices.filter((i) => i.status === 'partially_paid').length },
                  { key: 'issued', label: 'Issued', count: invoices.filter((i) => i.status === 'issued').length },
                  { key: 'overdue', label: 'Overdue', count: invoices.filter((i) => i.status === 'overdue').length }
                ]}
                value={filter}
                onChange={setFilter}
              />
            </div>

            <div className="inv-rows">
              {shownInvoices.length === 0 ? (
                <Empty icon="receipt" title="No invoices found" body="Create an invoice to bill clients." />
              ) : null}

              {shownInvoices.map((inv, i) => (
                <button
                  key={inv.id}
                  type="button"
                  className={`inv-row ${selectedInvoice?.id === inv.id ? 'on' : ''}`}
                  style={{ '--i': i }}
                  onClick={() => setSelId(inv.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: 'var(--soft)' }}>
                    <Icon name="receipt" size={18} />
                  </div>
                  <div>
                    <strong style={{ display: 'block', fontSize: '13.5px' }}>{inv.invoice_number}</strong>
                    <small style={{ color: 'var(--sub)', fontSize: '12px' }}>{inv.client_name} · {inv.business_name || 'Client'}</small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <b style={{ display: 'block', fontSize: '13.5px' }}>₹{Number(inv.total).toLocaleString('en-IN')}</b>
                    {inv.balance_due > 0 ? (
                      <small style={{ color: 'var(--amber)', fontSize: '11px' }}>Due: ₹{Number(inv.balance_due).toLocaleString('en-IN')}</small>
                    ) : (
                      <small style={{ color: 'var(--green)', fontSize: '11px' }}>Fully Paid</small>
                    )}
                  </div>
                  <span
                    className="pill-tag"
                    style={{
                      textTransform: 'capitalize',
                      background: inv.status === 'paid' ? 'rgba(34, 197, 94, 0.15)' : inv.status === 'partially_paid' ? 'rgba(99, 102, 241, 0.15)' : 'var(--soft)',
                      color: inv.status === 'paid' ? '#16a34a' : inv.status === 'partially_paid' ? '#4f46e5' : 'var(--ink)'
                    }}
                  >
                    {inv.status.replace('_', ' ')}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Invoice Document Preview */}
          <section className="card invoice-preview" style={{ '--d': '260ms' }}>
            {selectedInvoice ? (
              <div className="paper">
                {selectedInvoice.status === 'paid' || selectedInvoice.balance_due === 0 ? (
                  <div className="paid-stamp" style={{ borderColor: 'var(--green)', color: 'var(--green)' }}>
                    PAID
                  </div>
                ) : null}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '18px' }}>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>THE BUSINESS WORK</h3>
                    <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--sub)' }}>We Make Business Simpler.</p>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--sub)' }}>hello@thebusinesswork.com</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="pill-tag" style={{ background: 'var(--accent)', color: '#fff', fontWeight: 700, padding: '4px 10px', fontSize: '11px' }}>
                      INVOICE
                    </span>
                    <div style={{ marginTop: '8px', fontSize: '12px' }}>
                      <b>Invoice #:</b> {selectedInvoice.invoice_number}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--sub)' }}>
                      <b>Issue Date:</b> {new Date(selectedInvoice.issue_date || selectedInvoice.created_at).toLocaleDateString('en-IN')}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--sub)' }}>
                      <b>Due Date:</b> {new Date(selectedInvoice.due_date).toLocaleDateString('en-IN')}
                    </div>
                  </div>
                </div>

                {/* Bill To */}
                <div style={{ marginBottom: '16px' }}>
                  <small style={{ textTransform: 'uppercase', color: 'var(--sub)', fontWeight: 700, fontSize: '10.5px' }}>BILLED TO</small>
                  <div style={{ fontSize: '15px', fontWeight: 700 }}>{selectedInvoice.client_name}</div>
                  {selectedInvoice.business_name ? <div style={{ fontSize: '13px', color: 'var(--sub)' }}>{selectedInvoice.business_name}</div> : null}
                  {selectedInvoice.client_phone ? <div style={{ fontSize: '12px', color: 'var(--sub)' }}>Phone: +{selectedInvoice.client_phone}</div> : null}
                </div>

                {/* Items Summary */}
                <div style={{ marginLeft: 'auto', width: '280px', background: 'var(--soft)', padding: '12px 16px', borderRadius: '12px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--sub)' }}>Subtotal:</span>
                    <b>₹{Number(selectedInvoice.subtotal).toLocaleString('en-IN')}</b>
                  </div>
                  {selectedInvoice.discount_value > 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px', color: 'var(--green)' }}>
                      <span>Discount:</span>
                      <b>- ₹{Number(selectedInvoice.discount_value).toLocaleString('en-IN')}</b>
                    </div>
                  ) : null}
                  {Number(selectedInvoice.tax_amount) > 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                      <span style={{ color: 'var(--sub)' }}>Tax:</span>
                      <span>₹{Number(selectedInvoice.tax_amount).toLocaleString('en-IN')}</span>
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 800, borderTop: '1px solid var(--line)', paddingTop: '6px' }}>
                    <span>Total Invoiced:</span>
                    <span>₹{Number(selectedInvoice.total).toLocaleString('en-IN')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--green)', marginTop: '4px' }}>
                    <span>Amount Paid:</span>
                    <b>₹{Number(selectedInvoice.amount_paid).toLocaleString('en-IN')}</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--amber)', fontWeight: 700, marginTop: '4px' }}>
                    <span>Balance Due:</span>
                    <b>₹{Number(selectedInvoice.balance_due).toLocaleString('en-IN')}</b>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                  <a
                    href={`${api.getBaseUrl()}/api/invoices/${selectedInvoice.id}/pdf${localStorage.getItem('tbw_token') ? `?token=${encodeURIComponent(localStorage.getItem('tbw_token'))}` : ''}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn solid"
                    style={{ textDecoration: 'none' }}
                  >
                    <Icon name="download" size={16} />
                    Download Official PDF
                  </a>

                  {selectedInvoice.balance_due > 0 ? (
                    <button
                      type="button"
                      className="btn solid"
                      style={{ background: 'var(--green)', borderColor: 'var(--green)' }}
                      onClick={() => {
                        setPayForm((prev) => ({ ...prev, amount: String(selectedInvoice.balance_due) }))
                        setPaying(true)
                      }}
                    >
                      <Icon name="coins" size={16} />
                      Record Payment
                    </button>
                  ) : null}

                  {selectedInvoice.balance_due > 0 ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => handleSendReminder(selectedInvoice)}
                    >
                      <Icon name="bell" size={16} />
                      Log Reminder
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <Empty icon="receipt" title="Select an invoice" body="Choose an invoice from the left to view document details." />
            )}
          </section>
        </div>
      )}

      {tab === 'payments' && (
        <section className="card" style={{ padding: '22px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>Confirmed Payment Receipts</h3>
          {payments.length === 0 ? (
            <Empty icon="check" title="No payments recorded" body="Payments recorded against invoices will appear here." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {payments.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    background: 'var(--soft)'
                  }}
                >
                  <div>
                    <strong style={{ display: 'block', fontSize: '13.5px' }}>{p.receipt_number || 'TBW-RCP-' + p.id}</strong>
                    <small style={{ color: 'var(--sub)' }}>
                      {p.client_name} · {p.invoice_number ? `Ref: ${p.invoice_number}` : 'Direct'} · Method: {p.method.toUpperCase()}
                      {p.reference_id ? ` (UTR: ${p.reference_id})` : ''}
                    </small>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <b style={{ fontSize: '15px', color: 'var(--green)' }}>+₹{Number(p.amount).toLocaleString('en-IN')}</b>
                    <a
                      href={`${api.getBaseUrl()}/api/payments/${p.id}/receipt`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn tiny"
                      style={{ textDecoration: 'none' }}
                    >
                      <Icon name="download" size={12} /> Receipt PDF
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'subscriptions' && (
        <section className="card" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px' }}>Client Subscriptions &amp; Retainers</h3>
            <span className="pill-tag" style={{ background: 'var(--soft)' }}>
              MRR: ₹{subscriptions.reduce((sum, s) => sum + (s.status === 'active' ? Number(s.monthly_fee) : 0), 0).toLocaleString('en-IN')}/mo
            </span>
          </div>

          {subscriptions.length === 0 ? (
            <Empty icon="layers" title="No active subscriptions" body="Active client retainers will appear here." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {subscriptions.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    background: 'var(--soft)'
                  }}
                >
                  <div>
                    <strong style={{ display: 'block', fontSize: '13.5px' }}>{s.name}</strong>
                    <small style={{ color: 'var(--sub)' }}>
                      {s.client_name} · Next billing: {s.next_billing ? new Date(s.next_billing).toLocaleDateString('en-IN') : '—'}
                    </small>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <b style={{ fontSize: '14px', color: 'var(--accent)' }}>₹{Number(s.monthly_fee).toLocaleString('en-IN')}/mo</b>
                    <span className="pill-tag" style={{ textTransform: 'capitalize' }}>{s.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* MODAL: Create Invoice */}
      <Modal open={creating} onClose={() => setCreating(false)} title="New Invoice" sub="Issue official INR invoice with clear due dates and line items.">
        <form className="form" onSubmit={handleCreateInvoice}>
          <div className="field-row">
            <label className="field">
              <span>Client *</span>
              <select
                value={form.client_id}
                onChange={(e) => setForm((prev) => ({ ...prev, client_id: e.target.value }))}
                required
              >
                <option value="">Select a Client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} {c.business_name ? `(${c.business_name})` : ''}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Due Date</span>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((prev) => ({ ...prev, due_date: e.target.value }))}
                required
              />
            </label>
          </div>

          <label className="field">
            <span>Item Description</span>
            <input
              value={form.items[0].description}
              onChange={(e) => {
                const val = e.target.value
                setForm((prev) => ({ ...prev, items: [{ ...prev.items[0], description: val }] }))
              }}
              placeholder="e.g. WhatsApp AI Agent Setup"
              required
            />
          </label>

          <label className="field">
            <span>Amount (INR)</span>
            <input
              type="number"
              min="1"
              value={form.items[0].unit_price}
              onChange={(e) => {
                const val = Number(e.target.value) || 0
                setForm((prev) => ({ ...prev, items: [{ ...prev.items[0], unit_price: val }] }))
              }}
              required
            />
          </label>

          <button type="submit" className="btn solid lg block">
            <Icon name="check" size={17} />
            Create &amp; Issue Invoice
          </button>
        </form>
      </Modal>

      {/* MODAL: Record Payment */}
      <Modal open={paying} onClose={() => setPaying(false)} title="Record Payment" sub={`Invoice: ${selectedInvoice?.invoice_number} (Balance Due: ₹${Number(selectedInvoice?.balance_due || 0).toLocaleString('en-IN')})`}>
        <form className="form" onSubmit={handleRecordPayment}>
          <div className="field-row">
            <label className="field">
              <span>Payment Amount (INR) *</span>
              <input
                type="number"
                min="1"
                max={selectedInvoice?.balance_due}
                value={payForm.amount}
                onChange={(e) => setPayForm((prev) => ({ ...prev, amount: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Payment Method</span>
              <select
                value={payForm.method}
                onChange={(e) => setPayForm((prev) => ({ ...prev, method: e.target.value }))}
              >
                <option value="upi">UPI (GPay / PhonePe / Paytm)</option>
                <option value="bank_transfer">Bank Transfer (IMPS / NEFT)</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>UTR / Reference ID</span>
              <input
                value={payForm.reference_id}
                onChange={(e) => setPayForm((prev) => ({ ...prev, reference_id: e.target.value }))}
                placeholder="e.g. UPI-9876543210"
              />
            </label>
            <label className="field">
              <span>Payment Date</span>
              <input
                type="date"
                value={payForm.payment_date}
                onChange={(e) => setPayForm((prev) => ({ ...prev, payment_date: e.target.value }))}
                required
              />
            </label>
          </div>

          <button type="submit" className="btn solid lg block">
            <Icon name="check" size={17} />
            Confirm Payment &amp; Issue Receipt
          </button>
        </form>
      </Modal>
    </>
  )
}
