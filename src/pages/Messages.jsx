import { useEffect, useRef, useState, useCallback } from 'react'
import Icon from '../components/Icon'
import { Persona } from '../components/Brand'
import { PageHead, Segmented } from '../components/ui'
import { useApp } from '../lib/store'
import { clock } from '../lib/format'
import { api } from '../lib/api'

export default function Messages() {
  const { params, toast } = useApp()
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(params.chat ?? null)
  const [messages, setMessages] = useState([])
  const [filter, setFilter] = useState('All')
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [quickReplies, setQuickReplies] = useState([])
  const [showClientPanel, setShowClientPanel] = useState(false)
  const [activeDetails, setActiveDetails] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [sending, setSending] = useState(false)

  const thread = useRef(null)

  // 1. Fetch conversations from backend
  const loadConversations = useCallback(async () => {
    try {
      const res = await api.get('/api/conversations')
      if (res.success && res.data.items) {
        setConversations(res.data.items)
        if (!activeId && res.data.items.length > 0) {
          setActiveId(res.data.items[0].id)
        }
      }
    } catch {
      // Backend not yet populated or offline; keep clean empty state
    } finally {
      setLoading(false)
    }
  }, [activeId])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // 2. Load quick replies templates
  useEffect(() => {
    api.get('/api/quick-replies')
      .then(res => {
        if (res.success && res.data) setQuickReplies(res.data)
      })
      .catch(() => {})
  }, [])

  // 3. Load active conversation messages & details
  useEffect(() => {
    if (!activeId) return

    setLoadingMsgs(true)
    Promise.all([
      api.get(`/api/conversations/${activeId}/messages`),
      api.get(`/api/conversations/${activeId}`)
    ]).then(([msgRes, detailRes]) => {
      if (msgRes.success && msgRes.data.items) {
        setMessages(msgRes.data.items)
      }
      if (detailRes.success && detailRes.data) {
        setActiveDetails(detailRes.data)
      }
      // Reset unread locally in conversation list
      setConversations(list => list.map(c => c.id === activeId ? { ...c, unread_count: 0 } : c))
    }).catch(err => {
      console.warn('Could not load conversation thread:', err.message)
    }).finally(() => {
      setLoadingMsgs(false)
    })
  }, [activeId])

  // 4. Connect to Real-time Server-Sent Events (SSE)
  useEffect(() => {
    let es = null
    try {
      const token = localStorage.getItem('tbw_token')
      const sseUrl = `${api.getBaseUrl()}/api/sse/events${token ? `?token=${token}` : ''}`
      es = new EventSource(sseUrl, { withCredentials: true })

      es.addEventListener('new_message', (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.conversation_id === activeId) {
            setMessages(prev => {
              if (prev.some(m => m.id === msg.id || (m.wa_message_id && m.wa_message_id === msg.wa_message_id))) {
                return prev
              }
              return [...prev, msg]
            })
          }
          // Update conversation last message in list
          setConversations(prev => prev.map(c => {
            if (c.id === msg.conversation_id) {
              return {
                ...c,
                last_message_preview: msg.content,
                last_message_at: msg.created_at,
                unread_count: msg.conversation_id === activeId ? 0 : (c.unread_count || 0) + 1
              }
            }
            return c
          }))
        } catch (err) {
          console.error('SSE parse error:', err)
        }
      })

      es.addEventListener('mode_change', (e) => {
        try {
          const data = JSON.parse(e.data)
          setConversations(prev => prev.map(c => c.id === data.conversationId ? { ...c, mode: data.mode } : c))
          if (activeId === data.conversationId) {
            setActiveDetails(prev => prev ? { ...prev, mode: data.mode } : prev)
          }
        } catch {}
      })

      es.addEventListener('status_update', (e) => {
        try {
          const data = JSON.parse(e.data)
          setMessages(prev => prev.map(m => m.id === data.messageId ? { ...m, delivery_status: data.status } : m))
        } catch {}
      })
    } catch (err) {
      console.warn('SSE connection could not be established:', err)
    }

    return () => {
      if (es) es.close()
    }
  }, [activeId])

  // Scroll to bottom when messages update
  useEffect(() => {
    const el = thread.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  const active = conversations.find(c => c.id === activeId) || activeDetails

  // 5. Toggle AI vs Human mode
  const toggleMode = async () => {
    if (!active) return
    const newMode = (active.mode === 'ai' ? 'human' : 'ai')
    try {
      await api.patch(`/api/conversations/${active.id}/mode`, { mode: newMode })
      setConversations(prev => prev.map(c => c.id === active.id ? { ...c, mode: newMode } : c))
      setActiveDetails(prev => prev ? { ...prev, mode: newMode } : prev)
      toast?.(
        newMode === 'human' ? 'Human Takeover Activated' : 'AI Bot Resumed',
        newMode === 'human' ? 'WhatsApp AI bot is paused for this conversation.' : 'WhatsApp AI agent will automatically reply to customer messages.'
      )
    } catch (err) {
      toast?.('Failed to change mode', err.message, { type: 'error' })
    }
  }

  // 6. Send manual outbound reply
  const send = async (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending || !active) return

    setSending(true)
    try {
      const res = await api.post(`/api/conversations/${active.id}/messages`, {
        content: text,
        message_type: 'text'
      })

      if (res.success && res.data) {
        setMessages(prev => [...prev, res.data])
        setDraft('')
        setShowQuickReplies(false)
      }
    } catch (err) {
      if (err.code === 'WINDOW_EXPIRED') {
        toast?.(
          '24-Hour Window Expired',
          'Standard text messages are blocked by WhatsApp outside the 24-hour customer window. Send an approved template message instead.',
          { type: 'error' }
        )
      } else {
        toast?.('Send failed', err.message, { type: 'error' })
      }
    } finally {
      setSending(false)
    }
  }

  // 7. Add internal note
  const addNote = async (e) => {
    e.preventDefault()
    if (!noteDraft.trim() || !active) return
    try {
      const res = await api.post(`/api/conversations/${active.id}/notes`, { content: noteDraft.trim() })
      if (res.success) {
        setActiveDetails(prev => prev ? { ...prev, notes: [res.data, ...(prev.notes || [])] } : prev)
        setNoteDraft('')
        toast?.('Note added', 'Internal conversation note saved.')
      }
    } catch (err) {
      toast?.('Failed to add note', err.message, { type: 'error' })
    }
  }

  // Filter conversations
  const filteredList = conversations
    .filter(c => {
      if (filter === 'Unread') return (c.unread_count || 0) > 0
      if (filter === 'AI') return c.mode === 'ai'
      if (filter === 'Human') return c.mode === 'human'
      return true
    })
    .filter(c => {
      if (!q.trim()) return true
      const term = q.toLowerCase()
      return (
        (c.contact_name && c.contact_name.toLowerCase().includes(term)) ||
        (c.phone_number && c.phone_number.includes(term)) ||
        (c.last_message_preview && c.last_message_preview.toLowerCase().includes(term))
      )
    })

  return (
    <>
      <PageHead
        title="WhatsApp Inbox"
        sub="Unified WhatsApp Cloud API inbox with real-time AI automation and human takeover."
      />

      <section className="card messenger" style={{ '--d': '0ms' }}>
        {/* Left Pane: Conversations List */}
        <aside className="convo-pane">
          <div className="convo-tools rv" style={{ '--i': 0 }}>
            <label className="search-box">
              <Icon name="search" size={18} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search phone or name…"
                aria-label="Search chats"
              />
            </label>
            <Segmented
              items={['All', 'Unread', 'AI', 'Human']}
              value={filter}
              onChange={setFilter}
              size="sm"
            />
          </div>

          <div className="convo-list">
            {loading && conversations.length === 0 ? (
              <p className="convo-empty">Loading conversations…</p>
            ) : filteredList.length === 0 ? (
              <p className="convo-empty">No conversations match your filter.</p>
            ) : (
              filteredList.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  className={`convo rv ${c.id === activeId ? 'on' : ''}`}
                  style={{ '--i': i + 1 }}
                  onClick={() => setActiveId(c.id)}
                >
                  <span className="convo-av">
                    <Persona name={c.contact_name || c.phone_number} hue={25} size={44} />
                    <i className="online" style={{ background: c.mode === 'ai' ? '#22c55e' : '#f59e0b' }} />
                  </span>

                  <span className="convo-txt">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong>{c.contact_name || c.phone_number}</strong>
                      <span className={`wa-badge ${c.mode}`}>
                        {c.mode === 'ai' ? '🤖 AI' : '👤 Human'}
                      </span>
                    </div>
                    <small className="wa-phone">+{c.phone_number}</small>
                    <small>
                      {c.last_message_preview || 'No messages yet'}
                    </small>
                  </span>

                  <span className="convo-meta">
                    <small>{c.last_message_at ? clock(new Date(c.last_message_at)) : ''}</small>
                    {c.unread_count > 0 && c.id !== activeId ? (
                      <b>{c.unread_count}</b>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Right Pane: Thread + Composer */}
        {active ? (
          <div className="thread-pane" key={active.id} style={{ position: 'relative' }}>
            {/* Thread Header */}
            <header className="thread-head">
              <Persona name={active.contact_name || active.phone_number} hue={25} size={42} />
              <div>
                <strong>{active.contact_name || 'WhatsApp Contact'}</strong>
                <small className="wa-phone">+{active.phone_number}</small>
              </div>

              {/* AI vs Human Takeover Toggle */}
              <button
                type="button"
                className={`wa-mode-toggle ${active.mode}`}
                onClick={toggleMode}
                title="Click to switch between AI automation and Human takeover"
              >
                <span>{active.mode === 'ai' ? '🤖 AI Mode Active' : '👤 Human Takeover'}</span>
                <small style={{ opacity: 0.7, fontSize: '11px' }}>(Switch)</small>
              </button>

              {/* Client Info Toggle */}
              <button
                type="button"
                className={`icon-btn soft ${showClientPanel ? 'active' : ''}`}
                aria-label="Client Details"
                onClick={() => setShowClientPanel(p => !p)}
                title="Customer Info & Notes"
              >
                <Icon name="users" size={18} />
              </button>
            </header>

            {/* 24-Hour WhatsApp Service Window Banner */}
            <div className={`wa-window-banner ${active.is_window_active ? 'active' : 'expired'}`}>
              <span>
                {active.is_window_active ? (
                  <>🟢 <strong>WhatsApp 24h Window Active:</strong> Direct messaging is open.</>
                ) : (
                  <>⚠️ <strong>WhatsApp 24h Window Expired:</strong> Standard text replies will be rejected by Meta. Approved template required.</>
                )}
              </span>
              <small style={{ opacity: 0.8 }}>
                {active.is_window_active ? 'Standard replies allowed' : 'Template only'}
              </small>
            </div>

            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
              {/* Messages Thread */}
              <div className="thread" ref={thread} style={{ flex: 1 }}>
                <span className="day-divider">WhatsApp Conversation History</span>

                {loadingMsgs ? (
                  <p className="convo-empty">Loading messages…</p>
                ) : messages.length === 0 ? (
                  <p className="convo-empty">No messages recorded in this conversation yet.</p>
                ) : (
                  messages.map((m, i) => {
                    const isMe = m.direction === 'outbound'
                    const isAi = m.sender_type === 'ai'

                    return (
                      <div
                        key={m.id || i}
                        className={`bubble ${isMe ? 'me' : 'them'} ${isAi ? 'ai-reply' : ''}`}
                        style={{ '--i': i }}
                      >
                        {isAi ? (
                          <span className="sender-label" style={{ color: '#16a34a' }}>
                            🤖 The Business Work AI
                          </span>
                        ) : isMe && m.sender_name ? (
                          <span className="sender-label" style={{ color: 'var(--ink)' }}>
                            👤 {m.sender_name}
                          </span>
                        ) : null}

                        <p>{m.content}</p>

                        <small>
                          {m.created_at ? clock(new Date(m.created_at)) : ''}
                          {isMe ? (
                            <span
                              className={`msg-ticks ${m.delivery_status}`}
                              title={`Status: ${m.delivery_status}${m.error_message ? ` - ${m.error_message}` : ''}`}
                            >
                              {m.delivery_status === 'pending'
                                ? ' 🕒 Pending'
                                : m.delivery_status === 'sent'
                                ? ' ✓ Sent'
                                : m.delivery_status === 'delivered'
                                ? ' ✓✓'
                                : m.delivery_status === 'read'
                                ? ' ✓✓'
                                : m.delivery_status === 'failed'
                                ? ' ⚠️ Failed'
                                : ''}
                            </span>
                          ) : null}
                        </small>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Customer CRM & Notes Side Panel */}
              {showClientPanel ? (
                <aside className="wa-client-panel">
                  <h4 style={{ margin: 0, fontSize: '14px' }}>Contact & CRM Profile</h4>

                  <div className="wa-client-section">
                    <label>WhatsApp Phone</label>
                    <span className="wa-phone">+{active.phone_number}</span>
                  </div>

                  {activeDetails?.business_name ? (
                    <div className="wa-client-section">
                      <label>Business</label>
                      <span>{activeDetails.business_name} ({activeDetails.industry || 'General'})</span>
                    </div>
                  ) : null}

                  {activeDetails?.lifecycle_status ? (
                    <div className="wa-client-section">
                      <label>Lead Stage</label>
                      <span style={{ textTransform: 'capitalize' }}>
                        {activeDetails.lifecycle_status.replace('_', ' ')}
                      </span>
                    </div>
                  ) : null}

                  {activeDetails?.requirement ? (
                    <div className="wa-client-section">
                      <label>Requirement</label>
                      <span>{activeDetails.requirement}</span>
                    </div>
                  ) : null}

                  <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '4px 0' }} />

                  <div className="wa-client-section">
                    <label>Internal Team Notes</label>
                    <form onSubmit={addNote} style={{ marginTop: '6px' }}>
                      <input
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="Add note for team…"
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: '8px',
                          border: '1px solid var(--line-2)',
                          background: 'var(--card)',
                          fontSize: '12px'
                        }}
                      />
                    </form>
                    <div>
                      {activeDetails?.notes && activeDetails.notes.length > 0 ? (
                        activeDetails.notes.map(n => (
                          <div key={n.id} className="wa-note-item">
                            <strong style={{ display: 'block', fontSize: '11px', color: 'var(--ink)' }}>
                              {n.author_name || 'Team member'}
                            </strong>
                            <p style={{ margin: '2px 0 0', color: 'var(--ink)' }}>{n.content}</p>
                          </div>
                        ))
                      ) : (
                        <small style={{ color: 'var(--muted)', marginTop: '4px' }}>No internal notes yet.</small>
                      )}
                    </div>
                  </div>
                </aside>
              ) : null}
            </div>

            {/* Quick Replies Tray Popover */}
            {showQuickReplies ? (
              <div className="quick-replies-tray">
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px 8px', borderBottom: '1px solid var(--line)' }}>
                  <strong style={{ fontSize: '12px' }}>Agency Quick Replies</strong>
                  <button
                    type="button"
                    onClick={() => setShowQuickReplies(false)}
                    style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--muted)', fontSize: '12px' }}
                  >
                    ✕ Close
                  </button>
                </div>
                {quickReplies.map(qr => (
                  <button
                    key={qr.id}
                    type="button"
                    className="quick-reply-item"
                    onClick={() => {
                      setDraft(qr.content)
                      setShowQuickReplies(false)
                    }}
                  >
                    <strong>{qr.title} ({qr.folder})</strong>
                    <small>{qr.content}</small>
                  </button>
                ))}
              </div>
            ) : null}

            {/* Composer */}
            <form className="composer" onSubmit={send}>
              {/* Quick Replies Button */}
              <button
                type="button"
                className={`icon-btn ${showQuickReplies ? 'active' : ''}`}
                aria-label="Quick replies"
                title="Insert Quick Reply"
                onClick={() => setShowQuickReplies(p => !p)}
              >
                <span style={{ fontSize: '14px' }}>⚡</span>
              </button>

              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  active.mode === 'ai'
                    ? `Reply as Human (AI will remain standby)…`
                    : `Message ${active.contact_name || active.phone_number}…`
                }
                aria-label="Message"
              />

              <button
                type="submit"
                className="send-btn"
                disabled={!draft.trim() || sending}
                aria-label="Send"
              >
                <Icon name="send" size={18} />
              </button>
            </form>
          </div>
        ) : (
          <div className="thread-pane" style={{ display: 'grid', placeItems: 'center' }}>
            <p className="convo-empty">Select a conversation from the left to begin messaging.</p>
          </div>
        )}
      </section>
    </>
  )
}
