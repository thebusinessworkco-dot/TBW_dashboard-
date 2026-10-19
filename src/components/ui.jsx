import { useEffect, useLayoutEffect, useRef } from 'react'
import Icon from './Icon'

/* ---------------- CountUp ----------------
   Writes straight into the DOM on every frame so a counting number never
   re-renders the page. Re-targets smoothly when `value` changes. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString('en-US'), duration = 1400, delay = 0, className }) {
  const ref = useRef(null)
  const shown = useRef(null)
  const fmt = useRef(format)

  useLayoutEffect(() => {
    fmt.current = format
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const from = shown.current ?? 0
    const to = value
    let raf = 0
    let start = 0
    const ease = (t) => 1 - Math.pow(1 - t, 4)
    const tick = (now) => {
      if (!start) start = now
      const t = Math.min(1, (now - start - delay) / duration)
      if (t < 0) {
        raf = requestAnimationFrame(tick)
        return
      }
      const v = from + (to - from) * ease(t)
      shown.current = v
      el.textContent = fmt.current(v)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    el.textContent = fmt.current(from)
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, delay])

  return <span ref={ref} className={className} />
}

/* ---------------- Delta chip ---------------- */
export function Delta({ value, suffix = '%', glass = false }) {
  const up = value >= 0
  return (
    <span className={`delta ${up ? 'up' : 'down'} ${glass ? 'glass' : ''}`}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={11} stroke={2.4} />
      {Math.abs(value)}
      {suffix}
    </span>
  )
}

const STATUS_TONE = {
  Completed: 'green',
  Pending: 'red',
  'In Progress': 'amber',
  paid: 'green',
  pending: 'amber',
  overdue: 'red',
}

export function Status({ value, label }) {
  return (
    <span className={`status ${STATUS_TONE[value] ?? 'muted'}`}>
      <i />
      {label ?? value}
    </span>
  )
}

export function Checkbox({ checked, mixed = false, onChange, label }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={label}
      className={`check ${checked ? 'on' : ''} ${mixed ? 'mixed' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {mixed ? <path d="M4 8h8" /> : <path d="m3.6 8.3 2.8 2.8 6-6.2" />}
      </svg>
    </button>
  )
}

export function Toggle({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle ${on ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!on)
      }}
    >
      <i />
    </button>
  )
}

/* ---------------- Segmented control with a sliding thumb ---------------- */
export function Segmented({ items, value, onChange, size = 'md' }) {
  const wrap = useRef(null)
  const thumb = useRef(null)

  useLayoutEffect(() => {
    const place = () => {
      const btn = wrap.current?.querySelector(`[data-key="${CSS.escape(String(value))}"]`)
      if (!btn || !thumb.current) return
      thumb.current.style.width = `${btn.offsetWidth}px`
      thumb.current.style.transform = `translateX(${btn.offsetLeft}px)`
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [value, items])

  return (
    <div className={`seg ${size}`} ref={wrap} role="tablist">
      <span className="seg-thumb" ref={thumb} />
      {items.map((it) => {
        const key = typeof it === 'string' ? it : it.key
        const label = typeof it === 'string' ? it : it.label
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={value === key}
            data-key={key}
            className={value === key ? 'on' : ''}
            onClick={() => onChange(key)}
          >
            {label}
            {typeof it === 'object' && it.count != null ? <em>{it.count}</em> : null}
          </button>
        )
      })}
    </div>
  )
}

/* ---------------- Popover ---------------- */
export function Popover({ open, onClose, anchor = 'right', className = '', children }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => {
      if (ref.current && !ref.current.parentElement.contains(e.target)) onClose()
    }
    const key = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} className={`pop ${anchor} ${className}`} role="menu">
      {children}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, tone }) {
  return (
    <button type="button" role="menuitem" className={`menu-item ${tone ?? ''}`} onClick={onClick}>
      {icon ? <Icon name={icon} size={17} /> : null}
      <span>{children}</span>
    </button>
  )
}

/* ---------------- Modal ---------------- */
export function Modal({ open, onClose, title, sub, width = 460, children, footer }) {
  useEffect(() => {
    if (!open) return undefined
    const key = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-veil" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            <h3>{title}</h3>
            {sub ? <p>{sub}</p> : null}
          </div>
          <button type="button" className="icon-btn soft" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  )
}

/* ---------------- Progress ring ---------------- */
export function Ring({ value, size = 96, stroke = 9, color = 'var(--accent)', track = 'var(--soft-2)', children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          className="ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ '--c': c }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-body">{children}</div>
    </div>
  )
}

/* ---------------- Page header ---------------- */
export function PageHead({ title, sub, children }) {
  const words = title.split(' ')
  return (
    <header className="page-head">
      <div>
        <h1 aria-label={title}>
          {words.map((w, i) => (
            <span key={`${w}-${i}`} className="word" style={{ '--i': i }} aria-hidden="true">
              {w}
              {i < words.length - 1 ? ' ' : ''}
            </span>
          ))}
        </h1>
        <p className="rv" style={{ '--i': words.length }}>
          {sub}
        </p>
      </div>
      {children ? <div className="page-actions rv" style={{ '--i': words.length + 1 }}>{children}</div> : null}
    </header>
  )
}

/** Small stat tile used across secondary pages. */
export function Kpi({ icon, label, value, format, delta, note, tone = '', d = 0, delay = 300 }) {
  return (
    <section className={`card kpi ${tone}`} style={{ '--d': `${d}ms` }}>
      <div className="kpi-head rv" style={{ '--i': 0 }}>
        <span className="kpi-ic">
          <Icon name={icon} size={18} />
        </span>
        <span>{label}</span>
      </div>
      <strong className="kpi-val rv" style={{ '--i': 1 }}>
        <CountUp value={value} format={format} delay={delay + d} />
      </strong>
      <div className="kpi-foot rv" style={{ '--i': 2 }}>
        {delta != null ? <Delta value={delta} /> : null}
        {note ? <span>{note}</span> : null}
      </div>
    </section>
  )
}

export function Empty({ icon = 'search', title, body }) {
  return (
    <div className="empty">
      <span>
        <Icon name={icon} size={22} />
      </span>
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
    </div>
  )
}

export function Toasts({ items, onDismiss }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone ?? ''}`}>
          <span className="toast-icon">
            <Icon name={t.icon ?? 'check'} size={16} stroke={2.2} />
          </span>
          <div>
            <strong>{t.title}</strong>
            {t.body ? <p>{t.body}</p> : null}
          </div>
          <button type="button" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
