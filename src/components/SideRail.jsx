import { useLayoutEffect, useRef } from 'react'
import Icon from './Icon'
import { useApp } from '../lib/store'

const RAIL = [
  { id: 'overview', icon: 'category', label: 'Dashboard' },
  { id: 'schedule', icon: 'calendar', label: 'Schedule' },
  { id: 'messages', icon: 'mail', label: 'Messages' },
  { id: 'invoices', icon: 'note', label: 'Invoices & Finance' },
  { id: 'contacts', icon: 'users', label: 'CRM & Leads' },
  { id: 'quotations', icon: 'receipt', label: 'Quotations' },
  { id: 'projects', icon: 'layers', label: 'Projects & Tasks' },
  { id: 'savings', icon: 'trend', label: 'Profitability' },
  { id: 'settings', icon: 'gear', label: 'Settings' },
]

const centre = (el) => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** Slides a group's highlight onto whichever button matches `selector`. */
function useIndicator(selector) {
  const group = useRef(null)
  const ind = useRef(null)
  useLayoutEffect(() => {
    const place = () => {
      const btn = group.current?.querySelector(selector)
      const el = ind.current
      if (!el) return
      if (!btn) {
        el.style.opacity = '0'
        el.style.scale = '0.4'
        return
      }
      el.style.opacity = '1'
      el.style.scale = '1'
      el.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(group.current)
    return () => ro.disconnect()
  }, [selector])
  return [group, ind]
}

export default function SideRail() {
  const { view, go, theme, switchTheme, openModal } = useApp()
  const [themeGroup, themeInd] = useIndicator(`[data-mode="${theme}"]`)
  const [navGroup, navInd] = useIndicator(`[data-rail="${view}"]`)
  const [footGroup, footInd] = useIndicator(`[data-rail="${view}"]`)

  return (
    <aside className="rail" aria-label="Sections">
      <div className="rail-group theme-group" ref={themeGroup}>
        <span className="rail-ind soft" ref={themeInd} />
        {[
          { mode: 'light', icon: 'sun', label: 'Light mode' },
          { mode: 'dark', icon: 'moon', label: 'Dark mode' },
        ].map((m, i) => (
          <button
            key={m.mode}
            type="button"
            data-mode={m.mode}
            className={`rail-btn ${theme === m.mode ? 'on' : ''}`}
            style={{ '--i': i }}
            aria-pressed={theme === m.mode}
            aria-label={m.label}
            data-tip={m.label}
            onClick={(e) => switchTheme(m.mode, centre(e.currentTarget))}
          >
            <Icon name={m.icon} size={22} className={m.mode === 'light' ? 'sun-ic' : 'moon-ic'} />
          </button>
        ))}
      </div>

      <nav className="rail-group main-group" ref={navGroup}>
        <span className="rail-ind" ref={navInd} />
        {RAIL.map((r, i) => (
          <button
            key={r.id}
            type="button"
            data-rail={r.id}
            data-tip={r.label}
            className={`rail-btn ${view === r.id ? 'on' : ''}`}
            style={{ '--i': i + 2 }}
            aria-label={r.label}
            aria-current={view === r.id ? 'page' : undefined}
            onClick={() => go(r.id)}
          >
            <Icon name={r.icon} size={22} />
          </button>
        ))}
      </nav>

      <div className="rail-group foot-group" ref={footGroup}>
        <span className="rail-ind" ref={footInd} />
        <button
          type="button"
          data-rail="help"
          data-tip="Help Center"
          className={`rail-btn ${view === 'help' ? 'on' : ''}`}
          style={{ '--i': 10 }}
          aria-label="Help Center"
          onClick={() => go('help')}
        >
          <Icon name="help" size={22} />
        </button>
        <button
          type="button"
          data-tip="Log out"
          className="rail-btn"
          style={{ '--i': 11 }}
          aria-label="Log out"
          onClick={() => openModal('logout')}
        >
          <Icon name="logout" size={22} />
        </button>
      </div>
    </aside>
  )
}
