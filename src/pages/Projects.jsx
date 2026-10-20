import { useState, useEffect } from 'react'
import Icon from '../components/Icon'
import { Empty, Kpi, Modal, PageHead, Segmented } from '../components/ui'
import { useApp } from '../lib/store'
import { api } from '../lib/api'

export default function Projects() {
  const { toast } = useApp()
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [automation, setAutomation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selProjectId, setSelProjectId] = useState(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [projectDetail, setProjectDetail] = useState(null)

  // New Project Form
  const [form, setForm] = useState(() => ({
    title: '',
    client_id: '',
    budget: '',
    deliverables: '',
    due_date: new Date(Date.now() + 21 * 86400000).toISOString().split('T')[0]
  }))

  // New Task Form
  const [taskForm, setTaskForm] = useState(() => ({
    title: '',
    priority: 'medium',
    due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  }))

  const loadData = async () => {
    try {
      setLoading(true)
      const [projRes, clientRes, autoRes] = await Promise.all([
        api.get('/api/projects').catch(() => ({ data: [] })),
        api.get('/api/clients?limit=100').catch(() => ({ data: { items: [] } })),
        api.get('/api/automation/status').catch(() => ({ data: null }))
      ])

      const list = projRes.data || []
      setProjects(list)
      if (list.length > 0 && !selProjectId) {
        setSelProjectId(list[0].id)
        loadProjectDetail(list[0].id)
      }

      const clientList = clientRes.data?.items || []
      setClients(clientList)
      if (clientList.length > 0 && !form.client_id) {
        setForm((prev) => ({ ...prev, client_id: String(clientList[0].id) }))
      }

      setAutomation(autoRes.data)
    } catch (err) {
      console.error('Failed to load project operations:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadProjectDetail = async (id) => {
    try {
      const res = await api.get(`/api/projects/${id}`)
      setProjectDetail(res.data)
    } catch (err) {
      console.error('Failed to load project detail:', err)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleSelectProject = (id) => {
    setSelProjectId(id)
    loadProjectDetail(id)
  }

  const handleCreateProject = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.client_id) return

    try {
      const payload = {
        ...form,
        client_id: Number(form.client_id),
        budget: form.budget ? Number(form.budget) : null
      }

      const res = await api.post('/api/projects', payload)
      if (res.success) {
        toast('Project Created', `${form.title} added to agency pipeline.`, { icon: 'check' })
        setCreatingProject(false)
        setForm({
          title: '',
          client_id: clients[0]?.id ? String(clients[0].id) : '',
          budget: '',
          deliverables: '',
          due_date: new Date(Date.now() + 21 * 86400000).toISOString().split('T')[0]
        })
        await loadData()
      }
    } catch (err) {
      toast('Creation Failed', err.message, { icon: 'close' })
    }
  }

  const handleCreateTask = async (e) => {
    e.preventDefault()
    if (!taskForm.title.trim() || !selProjectId) return

    try {
      const res = await api.post(`/api/projects/${selProjectId}/tasks`, taskForm)
      if (res.success) {
        toast('Task Added', taskForm.title, { icon: 'check' })
        setCreatingTask(false)
        setTaskForm({
          title: '',
          priority: 'medium',
          due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
        })
        await loadProjectDetail(selProjectId)
        await loadData()
      }
    } catch (err) {
      toast('Error', err.message, { icon: 'close' })
    }
  }

  const toggleTaskStatus = async (task) => {
    const nextStatus = task.status === 'done' ? 'todo' : 'done'
    try {
      await api.patch(`/api/projects/tasks/${task.id}`, { status: nextStatus })
      await loadProjectDetail(selProjectId)
      await loadData()
    } catch (err) {
      toast('Error', err.message, { icon: 'close' })
    }
  }

  const activeProjectsCount = projects.filter((p) => p.status !== 'delivered' && p.status !== 'archived').length
  const totalBudget = projects.reduce((s, p) => s + (Number(p.budget) || 0), 0)

  return (
    <>
      <PageHead
        title="Projects &amp; Operations"
        sub="Track agency client deliverables, project task pipelines, and n8n background automation health."
      >
        <button type="button" className="btn solid lg" onClick={() => setCreatingProject(true)}>
          <Icon name="plus" size={18} />
          New Project
        </button>
      </PageHead>

      <div className="kpis three" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '22px' }}>
        <Kpi
          icon="layers"
          label="Active Projects"
          value={activeProjectsCount}
          format={(n) => `${n} Projects`}
          note={`${projects.length} Total`}
          tone="accent"
        />
        <Kpi
          icon="coins"
          label="Committed Project Budget"
          value={totalBudget}
          format={(n) => `₹${n.toLocaleString('en-IN')}`}
          note="Active contract value"
          tone="green"
        />
        <Kpi
          icon="bolt"
          label="Automation Engine (n8n)"
          value={automation?.active_workflows || automation?.total_workflows || 0}
          format={(n) => `${n} Workflows`}
          note={automation?.healthy === null ? 'Status Unknown' : automation?.healthy ? 'Operational' : 'Review Errors'}
          tone={automation?.healthy ? 'green' : automation?.healthy === false ? 'amber' : 'neutral'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1.7fr)', gap: '22px', alignItems: 'start' }}>
        {/* Project List */}
        <section className="card" style={{ padding: '22px' }}>
          <div className="section-head" style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Client Projects</h3>
          </div>

          {projects.length === 0 ? (
            <Empty icon="layers" title="No projects yet" body="Accepted quotes can be converted into projects." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {projects.map((p) => {
                const total = p.total_tasks || 0
                const done = p.completed_tasks || 0
                const pct = total > 0 ? Math.round((done / total) * 100) : 0
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`inv-row ${selProjectId === p.id ? 'on' : ''}`}
                    onClick={() => handleSelectProject(p.id)}
                    style={{ padding: '12px 14px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: 'var(--soft)' }}>
                      <Icon name="layers" size={17} />
                    </div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '13.5px' }}>{p.title}</strong>
                      <small style={{ color: 'var(--sub)' }}>{p.client_name} · Due: {p.due_date || 'Ongoing'}</small>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="pill-tag" style={{ textTransform: 'capitalize', fontSize: '11px' }}>{p.status}</span>
                      <small style={{ display: 'block', color: 'var(--sub)', marginTop: '2px', fontSize: '11px' }}>{done}/{total} Tasks ({pct}%)</small>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* Project Tasks & Automation Health */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <section className="card" style={{ padding: '22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                  {projectDetail?.title || 'Project Tasks'}
                </h3>
                <small style={{ color: 'var(--sub)' }}>{projectDetail?.client_name || 'Select a project'}</small>
              </div>

              {selProjectId ? (
                <button type="button" className="btn solid tiny" onClick={() => setCreatingTask(true)}>
                  <Icon name="plus" size={13} /> Add Task
                </button>
              ) : null}
            </div>

            {projectDetail?.deliverables ? (
              <div style={{ background: 'var(--soft)', padding: '10px 14px', borderRadius: '10px', fontSize: '12px', marginBottom: '14px', whiteSpace: 'pre-line' }}>
                <b>Scope &amp; Deliverables:</b>
                <div style={{ marginTop: '4px', color: 'var(--sub)' }}>{projectDetail.deliverables}</div>
              </div>
            ) : null}

            {(projectDetail?.tasks || []).length === 0 ? (
              <Empty icon="check" title="No tasks added yet" body="Add milestone tasks for this client deliverable." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(projectDetail?.tasks || []).map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      background: 'var(--soft)',
                      border: '1px solid var(--line)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input
                        type="checkbox"
                        checked={t.status === 'done'}
                        onChange={() => toggleTaskStatus(t)}
                        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                      />
                      <span style={{ fontSize: '13px', textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--sub)' : 'var(--ink)' }}>
                        {t.title}
                      </span>
                    </div>
                    <span
                      className="pill-tag"
                      style={{
                        fontSize: '10px',
                        textTransform: 'uppercase',
                        background: t.priority === 'urgent' ? 'rgba(239, 68, 68, 0.15)' : 'var(--card)',
                        color: t.priority === 'urgent' ? '#dc2626' : 'var(--sub)'
                      }}
                    >
                      {t.priority}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Automation Monitoring Panel */}
          <section className="card" style={{ padding: '22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700 }}>n8n Automation Engine Status</h4>
              <span
                className="pill-tag"
                style={{
                  background: automation?.healthy ? 'rgba(34, 197, 94, 0.15)' : automation?.healthy === false ? 'rgba(245, 158, 11, 0.15)' : 'var(--soft)',
                  color: automation?.healthy ? '#16a34a' : automation?.healthy === false ? '#d97706' : 'var(--muted)',
                  fontWeight: 700
                }}
              >
                {automation?.healthy ? 'Active & Healthy' : automation?.healthy === false ? 'Warning' : 'Unknown'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(automation?.workflows || []).length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '8px 0' }}>
                  No automation workflows connected yet.
                </div>
              ) : (
                (automation?.workflows || []).map((w) => (
                  <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '8px 10px', background: 'var(--soft)', borderRadius: '8px' }}>
                    <span>{w.workflow_name}</span>
                    <span style={{ color: w.last_status === 'success' ? 'var(--green)' : w.last_status === 'error' ? 'var(--red)' : 'var(--muted)', fontWeight: 600 }}>
                      {w.last_status === 'success' ? 'Operational' : w.last_status === 'error' ? 'Error' : 'Unknown'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {/* MODAL: Create Project */}
      <Modal open={creatingProject} onClose={() => setCreatingProject(false)} title="New Client Project" sub="Create project deliverable and assign initial budget.">
        <form className="form" onSubmit={handleCreateProject}>
          <label className="field">
            <span>Project Title *</span>
            <input
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. Meta Cloud API + Google Sheets Bot"
              required
            />
          </label>

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
              <span>Budget (INR)</span>
              <input
                type="number"
                min="0"
                value={form.budget}
                onChange={(e) => setForm((prev) => ({ ...prev, budget: e.target.value }))}
                placeholder="75000"
              />
            </label>
          </div>

          <label className="field">
            <span>Scope of Deliverables</span>
            <textarea
              rows={2}
              value={form.deliverables}
              onChange={(e) => setForm((prev) => ({ ...prev, deliverables: e.target.value }))}
              placeholder="1. n8n workflow deployment\n2. WhatsApp Webhook setup"
            />
          </label>

          <button type="submit" className="btn solid lg block" disabled={!form.title.trim() || !form.client_id}>
            <Icon name="check" size={17} />
            Create Project
          </button>
        </form>
      </Modal>

      {/* MODAL: Create Task */}
      <Modal open={creatingTask} onClose={() => setCreatingTask(false)} title="Add Task" sub={`Under project: ${projectDetail?.title}`}>
        <form className="form" onSubmit={handleCreateTask}>
          <label className="field">
            <span>Task Title *</span>
            <input
              value={taskForm.title}
              onChange={(e) => setTaskForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. Verify Webhook SSL Certificate"
              required
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Priority</span>
              <select
                value={taskForm.priority}
                onChange={(e) => setTaskForm((prev) => ({ ...prev, priority: e.target.value }))}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>

            <label className="field">
              <span>Due Date</span>
              <input
                type="date"
                value={taskForm.due_date}
                onChange={(e) => setTaskForm((prev) => ({ ...prev, due_date: e.target.value }))}
              />
            </label>
          </div>

          <button type="submit" className="btn solid lg block" disabled={!taskForm.title.trim()}>
            <Icon name="plus" size={17} />
            Save Task
          </button>
        </form>
      </Modal>
    </>
  )
}
