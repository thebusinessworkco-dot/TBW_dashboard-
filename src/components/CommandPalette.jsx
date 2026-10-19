import { useMemo, useState } from 'react'
import Icon from './Icon'
import { ActivityLogo, Persona } from './Brand'
import { useApp } from '../lib/store'
import { money } from '../lib/format'

export default function CommandPalette({ open, onClose, views }) {
  if (!open) return null
  return <Palette onClose={onClose} views={views} />
}

function Palette({ onClose, views }) {
  const { go, activities, contacts, openModal } = useApp()
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    const match = (s) => s.toLowerCase().includes(term)
    const pages = views
      .filter((v) => !term || match(v.label) || match(v.id))
      .map((v) => ({ type: 'Pages', key: `p-${v.id}`, icon: v.icon, title: v.label, meta: 'Go to page', run: () => go(v.id) }))
    const actions = [
      { title: 'Send money', icon: 'send', run: () => openModal('transfer') },
      { title: 'Request money', icon: 'arrowDown', run: () => openModal('request') },
      { title: 'Add a new card', icon: 'card', run: () => openModal('addCard') },
    ]
      .filter((a) => !term || match(a.title))
      .map((a) => ({ type: 'Actions', key: `a-${a.title}`, meta: 'Quick action', ...a }))
    const tx = term
      ? activities
          .filter((a) => match(a.title) || match(a.id))
          .slice(0, 5)
          .map((a) => ({
            type: 'Transactions',
            key: `t-${a.key}`,
            logo: a.logo,
            title: a.title,
            meta: `${a.id} · ${money(a.price)}`,
            run: () => openModal('activity', { key: a.key }),
          }))
      : []
    const people = term
      ? contacts
          .filter((c) => match(c.name) || match(c.handle))
          .slice(0, 4)
          .map((c) => ({ type: 'Contacts', key: `c-${c.id}`, person: c, title: c.name, meta: c.handle, run: () => openModal('transfer', { to: c.name }) }))
      : []
    return [...actions, ...pages, ...tx, ...people]
  }, [q, views, activities, contacts, go, openModal])

  const active = Math.min(cursor, Math.max(0, results.length - 1))

  const pick = (r) => {
    onClose()
    r.run()
  }

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(results.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (e.key === 'Enter' && results[active]) {
      pick(results[active])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  let lastType = null
  return (
    <div className="modal-veil palette-veil" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <label className="palette-input">
          <Icon name="search" size={20} />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onKey}
            placeholder="Search pages, transactions, people…"
          />
          <kbd>esc</kbd>
        </label>
        <div className="palette-list">
          {results.length === 0 ? <p className="palette-empty">No results for “{q}”</p> : null}
          {results.map((r, i) => {
            const head = r.type !== lastType ? r.type : null
            lastType = r.type
            return (
              <div key={r.key}>
                {head ? <h6>{head}</h6> : null}
                <button
                  type="button"
                  className={`palette-row ${i === active ? 'on' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(r)}
                >
                  <span className="palette-ic">
                    {r.logo ? <ActivityLogo kind={r.logo} size={20} /> : r.person ? <Persona name={r.person.name} hue={r.person.hue} size={26} /> : <Icon name={r.icon} size={18} />}
                  </span>
                  <span className="palette-txt">
                    <strong>{r.title}</strong>
                    <small>{r.meta}</small>
                  </span>
                  <Icon name="arrowRight" size={16} className="palette-go" />
                </button>
              </div>
            )
          })}
        </div>
        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            <kbd>⌘</kbd>
            <kbd>K</kbd> anywhere
          </span>
        </footer>
      </div>
    </div>
  )
}
