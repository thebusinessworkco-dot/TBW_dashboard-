import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { Avatar, Logo } from './Brand'
import { MenuItem, Popover } from './ui'
import { useApp } from '../lib/store'

import { api } from '../lib/api'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'messages', label: 'WhatsApp' },
  { id: 'contacts', label: 'CRM & Leads' },
  { id: 'quotations', label: 'Quotations' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'reports', label: 'Reports' },
]

export default function TopBar() {
  const app = useApp()
  const { view, go, user } = app
  const nav = useRef(null)
  const ind = useRef(null)
  const [open, setOpen] = useState(null)
  const [dbNotifs, setDbNotifs] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)

  useLayoutEffect(() => {
    const place = () => {
      const btn = nav.current?.querySelector(`[data-tab="${view}"]`)
      const el = ind.current
      if (!el) return
      if (!btn) {
        el.style.opacity = '0'
        return
      }
      el.style.opacity = '1'
      el.style.width = `${btn.offsetWidth}px`
      el.style.transform = `translateX(${btn.offsetLeft}px)`
      const n = nav.current
      if (n.scrollWidth > n.clientWidth) n.scrollTo({ left: btn.offsetLeft - 24, behavior: 'smooth' })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(nav.current)
    return () => ro.disconnect()
  }, [view])

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.get('/api/notifications')
      if (res.success && res.data) {
        setDbNotifs(res.data.items || [])
        setUnreadCount(res.data.unread_count || 0)
      }
    } catch {
      // Fallback
    }
  }, [])

  useEffect(() => {
    loadNotifications()
    const timer = setInterval(loadNotifications, 30000)
    return () => clearInterval(timer)
  }, [loadNotifications])

  const markAllRead = async () => {
    try {
      await api.patch('/api/notifications/read-all')
      setDbNotifs(list => list.map(n => ({ ...n, is_read: 1 })))
      setUnreadCount(0)
    } catch {}
  }

  const markSingleRead = async (id) => {
    try {
      await api.patch(`/api/notifications/${id}/read`)
      setDbNotifs(list => list.map(n => n.id === id ? { ...n, is_read: 1 } : n))
      setUnreadCount(c => Math.max(0, c - 1))
    } catch {}
  }

  const close = useCallback(() => setOpen(null), [])
  const toggle = (k) => setOpen((o) => (o === k ? null : k))

  return (
    <header className="topbar">
      <button type="button" className="pill brand" onClick={() => go('overview')} aria-label="The Business Work home">
        <Logo />
        <span className="brand-name">The Business Work</span>
      </button>

      <nav className="pill nav" ref={nav} aria-label="Primary">
        <span className="nav-ind" ref={ind} />
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            data-tab={t.id}
            className={view === t.id ? 'on' : ''}
            style={{ '--i': i }}
            onClick={() => go(t.id)}
            aria-current={view === t.id ? 'page' : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="pill tools">
        <button type="button" className="tool" onClick={app.openPalette} aria-label="Search (⌘K)" title="Search  ⌘K">
          <Icon name="search" size={23} />
        </button>

        <div className="anchor">
          <button type="button" className={`tool ${open === 'bell' ? 'on' : ''}`} onClick={() => toggle('bell')} aria-label="Notifications">
            <Icon name="bell" size={23} />
            {unreadCount > 0 ? <i className="bell-dot" /> : null}
          </button>
          <Popover open={open === 'bell'} onClose={close} className="notif-pop">
            <div className="pop-head">
              <strong>Notifications</strong>
              <button
                type="button"
                className="link"
                disabled={unreadCount === 0}
                onClick={markAllRead}
              >
                Mark all as read
              </button>
            </div>
            <div className="notif-list">
              {dbNotifs.length > 0 ? (
                dbNotifs.slice(0, 6).map((n, i) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`notif ${!n.is_read ? 'unread' : ''}`}
                    style={{ '--i': i }}
                    onClick={() => markSingleRead(n.id)}
                  >
                    <span className="notif-ic accent">
                      <Icon name="bell" size={16} stroke={2} />
                    </span>
                    <span className="notif-txt">
                      <strong>{n.title}</strong>
                      <small>{n.body}</small>
                    </span>
                    <em>{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</em>
                  </button>
                ))
              ) : (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12.5px' }}>
                  No new notifications.
                </div>
              )}
            </div>
            <button
              type="button"
              className="pop-foot"
              onClick={() => {
                close()
                go('activity')
              }}
            >
              View all activity <Icon name="arrowRight" size={15} />
            </button>
          </Popover>
        </div>

        <div className="anchor">
          <button type="button" className={`tool ${open === 'info' ? 'on' : ''}`} onClick={() => toggle('info')} aria-label="Alerts">
            <Icon name="info" size={23} />
          </button>
          <Popover open={open === 'info'} onClose={close} className="alert-pop">
            <div className="pop-head">
              <strong>System Operations</strong>
              <span className="pop-badge">LIVE</span>
            </div>
            <div className="alert-row">
              <span className="notif-ic green">
                <Icon name="check" size={16} stroke={2} />
              </span>
              <span className="notif-txt">
                <strong>WhatsApp Inbound Router</strong>
                <small>Meta Cloud API & n8n webhook active</small>
              </span>
              <button
                type="button"
                className="btn tiny"
                onClick={() => {
                  close()
                  go('messages')
                }}
              >
                Inbox
              </button>
            </div>
            <div className="alert-row">
              <span className="notif-ic accent">
                <Icon name="layers" size={16} stroke={2} />
              </span>
              <span className="notif-txt">
                <strong>CRM & Lead Qualification</strong>
                <small>Pipeline scoring & human takeover ready</small>
              </span>
              <button
                type="button"
                className="btn tiny"
                onClick={() => {
                  close()
                  go('contacts')
                }}
              >
                Leads
              </button>
            </div>
            <div className="alert-row">
              <span className="notif-ic blue">
                <Icon name="shield" size={16} stroke={2} />
              </span>
              <span className="notif-txt">
                <strong>Audit Trail & RBAC</strong>
                <small>Session secure with SHA-256 tokens</small>
              </span>
              <button
                type="button"
                className="btn tiny"
                onClick={() => {
                  close()
                  go('activity')
                }}
              >
                Audit
              </button>
            </div>
          </Popover>
        </div>
      </div>

      <div className="anchor">
        <button type="button" className={`pill user ${open === 'user' ? 'on' : ''}`} onClick={() => toggle('user')} aria-label="Account menu">
          <Avatar />
          <span className="user-txt">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </span>
          <Icon name="chevDown" size={18} className="user-chev" />
        </button>
        <Popover open={open === 'user'} onClose={close} className="user-pop">
          <div className="user-card">
            <Avatar size={44} />
            <div>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </div>
          </div>
          <MenuItem icon="user" onClick={() => (close(), go('account'))}>
            My account
          </MenuItem>
          <MenuItem icon="gear" onClick={() => (close(), go('settings'))}>
            Settings
          </MenuItem>
          <MenuItem icon="help" onClick={() => (close(), go('help'))}>
            Help Center
          </MenuItem>
          <MenuItem icon="replay" onClick={() => (close(), app.replayIntro())}>
            Replay intro animation
          </MenuItem>
          <hr />
          <MenuItem icon="logout" tone="danger" onClick={() => (close(), app.openModal('logout'))}>
            Log out
          </MenuItem>
        </Popover>
      </div>
    </header>
  )
}
