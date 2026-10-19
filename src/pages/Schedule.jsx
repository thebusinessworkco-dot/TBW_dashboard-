import { useState, useEffect } from 'react'
import Icon from '../components/Icon'
import { Empty, Kpi, Modal, PageHead } from '../components/ui'
import { useApp } from '../lib/store'
import { api } from '../lib/api'

export default function Schedule() {
  const { toast, go } = useApp()
  const [appointments, setAppointments] = useState([])
  const [followUps, setFollowUps] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [scheduling, setScheduling] = useState(false)

  // New appointment form
  const [form, setForm] = useState({
    client_id: '',
    title: 'Client Discovery Call',
    type: 'discovery_call',
    start_time: '',
    end_time: '',
    location: 'Google Meet',
    meeting_link: 'https://meet.google.com/tbw-call',
    notes: ''
  })

  const loadData = async () => {
    try {
      setLoading(true)
      const [aptRes, fuRes, clientRes] = await Promise.all([
        api.get('/api/appointments').catch(() => ({ data: [] })),
        api.get('/api/clients/follow-ups').catch(() => ({ data: [] })),
        api.get('/api/clients?limit=100').catch(() => ({ data: { items: [] } }))
      ])

      setAppointments(aptRes.data || [])
      setFollowUps(fuRes.data || [])
      const clientList = clientRes.data?.items || []
      setClients(clientList)
      if (clientList.length > 0 && !form.client_id) {
        setForm((prev) => ({ ...prev, client_id: String(clientList[0].id) }))
      }
    } catch (err) {
      console.error('Failed to load schedule data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleScheduleAppointment = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.start_time) return

    try {
      const payload = {
        ...form,
        client_id: form.client_id ? Number(form.client_id) : null,
        end_time: form.end_time || form.start_time
      }

      const res = await api.post('/api/appointments', payload)
      if (res.success) {
        toast('Appointment Scheduled', `${form.title} on ${form.start_time}`, { icon: 'calendar' })
        setScheduling(false)
        await loadData()
      }
    } catch (err) {
      toast('Scheduling Error', err.message, { icon: 'close' })
    }
  }

  const updateStatus = async (id, status) => {
    try {
      await api.patch(`/api/appointments/${id}/status`, { status })
      toast('Status Updated', `Appointment marked as ${status}`, { icon: 'check' })
      await loadData()
    } catch (err) {
      toast('Error', err.message, { icon: 'close' })
    }
  }

  const upcomingCount = appointments.filter((a) => a.status === 'scheduled').length
  const overdueFollowUps = followUps.filter((f) => f.reminder_urgency === 'overdue').length
  const todayFollowUps = followUps.filter((f) => f.reminder_urgency === 'today').length

  return (
    <>
      <PageHead
        title="Schedule &amp; Operations"
        sub="Discovery calls, client demo meetings, onboarding appointments, and automated lead follow-ups."
      >
        <button type="button" className="btn solid lg" onClick={() => setScheduling(true)}>
          <Icon name="plus" size={18} />
          Book Appointment
        </button>
      </PageHead>

      <div className="kpis three" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '22px' }}>
        <Kpi
          icon="calendar"
          label="Upcoming Meetings"
          value={upcomingCount}
          format={(n) => `${n} Scheduled`}
          note="Next 7 days"
          tone="accent"
        />
        <Kpi
          icon="bell"
          label="Due Follow-ups"
          value={overdueFollowUps + todayFollowUps}
          format={(n) => `${n} Reminders`}
          note={`${overdueFollowUps} Overdue · ${todayFollowUps} Today`}
          tone={overdueFollowUps > 0 ? 'amber' : 'green'}
        />
        <Kpi
          icon="check"
          label="Total Appointments"
          value={appointments.length}
          format={(n) => `${n} Logged`}
          note="All time scheduled"
          tone="green"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: '22px', alignItems: 'start' }}>
        {/* Appointments Feed */}
        <section className="card" style={{ padding: '22px' }}>
          <div className="section-head" style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Appointments &amp; Client Calls</h3>
          </div>

          {appointments.length === 0 ? (
            <Empty icon="calendar" title="No appointments scheduled" body="Book a discovery call or strategy review." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {appointments.map((a) => (
                <div
                  key={a.id}
                  style={{
                    padding: '14px 16px',
                    borderRadius: '14px',
                    background: 'var(--soft)',
                    border: '1px solid var(--line)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ fontSize: '14px' }}>{a.title}</strong>
                      <div style={{ fontSize: '12px', color: 'var(--sub)', marginTop: '2px' }}>
                        {a.client_name ? `${a.client_name} · ` : ''}{new Date(a.start_time).toLocaleString('en-IN')}
                      </div>
                    </div>
                    <span
                      className="pill-tag"
                      style={{
                        textTransform: 'capitalize',
                        background: a.status === 'completed' ? 'rgba(34, 197, 94, 0.15)' : 'var(--card)',
                        color: a.status === 'completed' ? '#16a34a' : 'var(--ink)'
                      }}
                    >
                      {a.status}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                    {a.meeting_link ? (
                      <a
                        href={a.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="btn tiny solid"
                        style={{ textDecoration: 'none' }}
                      >
                        <Icon name="monitor" size={13} /> Join Meeting
                      </a>
                    ) : null}

                    {a.status === 'scheduled' ? (
                      <button
                        type="button"
                        className="btn tiny"
                        onClick={() => updateStatus(a.id, 'completed')}
                      >
                        <Icon name="check" size={13} /> Mark Done
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Client Follow-ups Panel */}
        <section className="card" style={{ padding: '22px' }}>
          <div className="section-head" style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Client Follow-up Reminders</h3>
          </div>

          {followUps.length === 0 ? (
            <Empty icon="users" title="All caught up!" body="No pending follow-ups due." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {followUps.map((f) => (
                <div
                  key={f.id}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    background: 'var(--soft)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <strong style={{ display: 'block', fontSize: '13px' }}>{f.name}</strong>
                    <small style={{ color: 'var(--sub)' }}>
                      Follow-up: {new Date(f.next_followup).toLocaleDateString('en-IN')}
                    </small>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      className="pill-tag"
                      style={{
                        textTransform: 'uppercase',
                        fontSize: '10px',
                        background: f.reminder_urgency === 'overdue' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                        color: f.reminder_urgency === 'overdue' ? '#dc2626' : '#d97706'
                      }}
                    >
                      {f.reminder_urgency}
                    </span>
                    {f.whatsapp_phone ? (
                      <button
                        type="button"
                        className="icon-btn soft sm"
                        title="Chat on WhatsApp"
                        onClick={() => go('messages')}
                      >
                        <Icon name="chat" size={14} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* MODAL: Book Appointment */}
      <Modal open={scheduling} onClose={() => setScheduling(false)} title="Book Appointment" sub="Schedule a discovery call or strategy session with automatic Google Meet integration.">
        <form className="form" onSubmit={handleScheduleAppointment}>
          <div className="field-row">
            <label className="field">
              <span>Client / Lead</span>
              <select
                value={form.client_id}
                onChange={(e) => setForm((prev) => ({ ...prev, client_id: e.target.value }))}
              >
                <option value="">No client linked (Internal Meeting)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} {c.business_name ? `(${c.business_name})` : ''}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Appointment Type</span>
              <select
                value={form.type}
                onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
              >
                <option value="discovery_call">Discovery Call (20 min)</option>
                <option value="demo">Product &amp; AI Bot Demo</option>
                <option value="proposal_review">Proposal &amp; Commercial Review</option>
                <option value="onboarding">Client Onboarding</option>
                <option value="support">Technical Support</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Meeting Title *</span>
            <input
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. AI Sales Bot Architecture Walkthrough"
              required
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Date &amp; Time *</span>
              <input
                type="datetime-local"
                value={form.start_time}
                onChange={(e) => setForm((prev) => ({ ...prev, start_time: e.target.value }))}
                required
              />
            </label>

            <label className="field">
              <span>Meeting Link</span>
              <input
                value={form.meeting_link}
                onChange={(e) => setForm((prev) => ({ ...prev, meeting_link: e.target.value }))}
                placeholder="https://meet.google.com/..."
              />
            </label>
          </div>

          <button type="submit" className="btn solid lg block" disabled={!form.title.trim() || !form.start_time}>
            <Icon name="calendar" size={17} />
            Schedule on Agency Calendar
          </button>
        </form>
      </Modal>
    </>
  )
}
