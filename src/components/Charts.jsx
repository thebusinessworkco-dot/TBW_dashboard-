import { useState } from 'react'

/* ---------------- Profit & Loss stacked bars (Total Income card) ---------------- */
export function PnlChart({ data, max = 50 }) {
  const [hover, setHover] = useState(null)
  const [show, setShow] = useState({ profit: true, loss: true })
  const ticks = [50, 40, 30, 20, 10, 0]

  const flip = (k) =>
    setShow((s) => {
      const next = { ...s, [k]: !s[k] }
      return next.profit || next.loss ? next : s
    })

  return (
    <div className="pnl">
      <div className="pnl-head rv" style={{ '--i': 2 }}>
        <strong>Profit and Loss</strong>
        <div className="legend">
          <button type="button" className={show.profit ? '' : 'off'} onClick={() => flip('profit')}>
            <i className="sw profit" />
            Profit
          </button>
          <button type="button" className={show.loss ? '' : 'off'} onClick={() => flip('loss')}>
            <i className="sw loss" />
            Loss
          </button>
        </div>
      </div>

      <div className="pnl-plot">
        <div className="pnl-axis">
          {ticks.map((t) => (
            <span key={t} className="rv" style={{ bottom: `${(t / max) * 100}%`, '--i': 3 + (5 - t / 10) * 0.4 }}>
              {t ? `${t}k` : '00'}
            </span>
          ))}
        </div>
        <div className="pnl-cols" onMouseLeave={() => setHover(null)}>
          {data.map((d, i) => (
            <div
              key={d.m}
              className={`pnl-col ${hover != null && hover !== i ? 'dim' : ''}`}
              style={{ '--i': i }}
              onMouseEnter={() => setHover(i)}
            >
              <div className="pnl-stack">
                <span className={`bar profit ${show.profit ? '' : 'gone'}`} style={{ height: `${(d.profit / max) * 100}%` }} />
                <span className={`bar loss ${show.loss ? '' : 'gone'}`} style={{ height: `${(d.loss / max) * 100}%` }} />
              </div>
              {hover === i ? (
                <div className="chart-tip" style={{ bottom: `calc(${((d.profit + d.loss) / max) * 100}% + 14px)` }}>
                  <b>{d.m} 2026</b>
                  <span>
                    <i className="sw profit" />
                    Profit <strong>${d.profit}k</strong>
                  </span>
                  <span>
                    <i className="sw loss" />
                    Loss <strong>${d.loss}k</strong>
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="pnl-months">
        <span />
        {data.map((d, i) => (
          <em key={d.m} className={`rv ${hover === i ? 'hot' : ''}`} style={{ '--i': 4 + i * 0.3 }}>
            {d.m}
          </em>
        ))}
      </div>
    </div>
  )
}

/* ---------------- Smooth line chart ---------------- */
const smooth = (pts) => {
  if (pts.length < 2) return ''
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const t = 0.18
    d += ` C ${p1[0] + (p2[0] - p0[0]) * t} ${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t} ${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]} ${p2[1]}`
  }
  return d
}

const niceMax = (v) => {
  if (!v || v <= 0 || isNaN(v)) return 10
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  return Math.ceil((v * 1.1) / p) * p
}

export function LineChart({ labels, series, height = 260, unit = 'k' }) {
  const [hover, setHover] = useState(null)
  const W = 1000
  const H = height
  const top = 12
  const bottom = 8
  const maxVal = Math.max(1, ...series.flatMap((s) => s.values || []))
  const max = niceMax(maxVal)
  const n = labels.length
  const x = (i) => (i / (n - 1)) * W
  const y = (v) => top + (1 - v / max) * (H - top - bottom)

  const lines = series.map((s) => {
    const pts = s.values.map((v, i) => [x(i), y(v)])
    return { ...s, d: smooth(pts), area: `${smooth(pts)} L ${W} ${H} L 0 ${H} Z` }
  })

  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  return (
    <div className="line-chart">
      <div className="lc-axis">
        {[1, 0.75, 0.5, 0.25, 0].map((f) => (
          <span key={f} style={{ top: `${(y(max * f) / H) * 100}%` }}>
            {Math.round(max * f)}
            {f ? unit : ''}
          </span>
        ))}
      </div>
      <div className="lc-plot" style={{ height: H }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {[1, 0.75, 0.5, 0.25, 0].map((f) => (
          <i key={f} className="lc-grid" style={{ top: `${(y(max * f) / H) * 100}%` }} />
        ))}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}>
          <defs>
            {lines.map((l) => (
              <linearGradient key={l.name} id={`lc-${l.name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={l.color} stopOpacity=".22" />
                <stop offset="1" stopColor={l.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {lines.map((l) => (l.fill ? <path key={`a-${l.name}`} className="lc-area" d={l.area} fill={`url(#lc-${l.name})`} /> : null))}
          {lines.map((l, i) => (
            <path
              key={l.name}
              className="lc-line"
              d={l.d}
              pathLength="1"
              fill="none"
              stroke={l.color}
              strokeWidth="2.6"
              strokeDasharray={l.dashed ? '0.008 0.012' : undefined}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              style={{ '--i': i }}
            />
          ))}
        </svg>
        {hover != null ? (
          <>
            <i className="lc-cursor" style={{ left: `${(hover / (n - 1)) * 100}%` }} />
            {lines.map((l) => (
              <i
                key={l.name}
                className="lc-dot"
                style={{ left: `${(hover / (n - 1)) * 100}%`, top: `${(y(l.values[hover]) / H) * 100}%`, '--c': l.color }}
              />
            ))}
            <div
              className={`chart-tip lc-tip ${hover > n * 0.6 ? 'left' : ''}`}
              style={{ left: `${(hover / (n - 1)) * 100}%`, top: `${(Math.min(...lines.map((l) => y(l.values[hover]))) / H) * 100}%` }}
            >
              <b>{labels[hover]}</b>
              {lines.map((l) => (
                <span key={l.name}>
                  <i className="sw" style={{ background: l.color }} />
                  {l.name}
                  <strong>
                    ₹{l.values[hover]}
                    {unit}
                  </strong>
                </span>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className="lc-labels">
        {labels.map((lb, i) => (
          <span key={lb} className={hover === i ? 'hot' : ''}>
            {lb}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ---------------- Donut ---------------- */
export function Donut({ data, colors, size = 210, stroke = 28, active, onActive, children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const total = data.reduce((s, d) => s + d.v, 0)
  const gap = 4
  const segs = data.map((d, i) => {
    const len = (d.v / total) * c
    const before = data.slice(0, i).reduce((s, x) => s + (x.v / total) * c, 0)
    return { ...d, i, len, before }
  })
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--soft)" strokeWidth={stroke} />
        {segs.map(({ name, i, len, before }) => (
          <circle
            key={name}
            className={`donut-seg ${active != null && active !== i ? 'dim' : ''} ${active === i ? 'hot' : ''}`}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={colors[i % colors.length]}
            strokeWidth={stroke}
            strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
            strokeDashoffset={-before}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ '--i': i, '--len': Math.max(0, len - gap), '--c': c }}
            onMouseEnter={() => onActive?.(i)}
            onMouseLeave={() => onActive?.(null)}
          />
        ))}
      </svg>
      <div className="donut-center">{children}</div>
    </div>
  )
}

/* ---------------- Mini bars ---------------- */
export function MiniBars({ data, format = (v) => v }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(...data.map((d) => d.v))
  return (
    <div className="mini-bars" onMouseLeave={() => setHover(null)}>
      {data.map((d, i) => (
        <div key={d.m} className={`mb-col ${i === data.length - 1 ? 'last' : ''}`} onMouseEnter={() => setHover(i)} style={{ '--i': i }}>
          {hover === i ? <span className="mb-tip">{format(d.v)}</span> : null}
          <span className="mb-bar" style={{ height: `${(d.v / max) * 100}%` }} />
          <em>{d.m}</em>
        </div>
      ))}
    </div>
  )
}
