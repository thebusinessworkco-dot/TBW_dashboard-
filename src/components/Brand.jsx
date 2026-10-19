import { useId } from 'react'
import Icon from './Icon'
import { initials } from '../lib/format'

export function Logo({ size = 44 }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id={id} x1="6" y1="4" x2="38" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent-deep)" />
        </linearGradient>
      </defs>
      <circle cx="22" cy="22" r="22" fill={`url(#${id})`} />
      <g fill="none" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
        <path className="logo-stroke" d="M13.2 13.5 22 30.8" />
        <path className="logo-stroke two" d="M30.8 13.5 22 30.8" />
      </g>
    </svg>
  )
}

/** Illustrated avatar for the signed-in user. */
export function Avatar({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="avatar-svg">
      <circle cx="20" cy="20" r="20" fill="#ebe5dc" />
      <path d="M5.5 40c1.2-7 7.2-10.6 14.5-10.6S33.3 33 34.5 40Z" fill="#2c3547" />
      <path d="M17 26.5h6v4.2c-1 1-2 1.4-3 1.4s-2-.4-3-1.4v-4.2Z" fill="#d9a07a" />
      <ellipse cx="12.6" cy="19.2" rx="1.4" ry="2" fill="#e2a982" />
      <ellipse cx="27.4" cy="19.2" rx="1.4" ry="2" fill="#e2a982" />
      <ellipse cx="20" cy="18.6" rx="7.4" ry="8.7" fill="#eab88f" />
      <path
        d="M12.5 18.4c-.9-6.4 2.7-10.6 7.7-10.6 5.4 0 8.4 3.8 7.4 10.4-.8-2.8-2.4-4.4-4.6-4.9-2.6.8-6.6.6-8.6-.8-.9 1.6-1.5 3.6-1.9 5.9Z"
        fill="#2a1d17"
      />
      <path
        d="M12.7 19.8c.2 6 3.5 9.6 7.3 9.6s7.1-3.6 7.3-9.6c-.8 2-2 3.1-3.3 3.3-1.2-1-2.6-1.4-4-1.4s-2.8.4-4 1.4c-1.3-.2-2.5-1.3-3.3-3.3Z"
        fill="#2a1d17"
      />
      <path d="M18.3 24.6c1.1.5 2.3.5 3.4 0" stroke="#e9b08c" strokeWidth=".9" strokeLinecap="round" fill="none" />
      <circle cx="17.1" cy="18.4" r=".85" fill="#2a1d17" />
      <circle cx="22.9" cy="18.4" r=".85" fill="#2a1d17" />
      <path d="M15.6 16.3c.9-.5 2-.6 2.9-.3m6 0c-.9-.3-2-.2-2.9.3" stroke="#2a1d17" strokeWidth=".9" strokeLinecap="round" fill="none" />
    </svg>
  )
}

const FLAG_ART = {
  us: (
    <>
      <rect width="20" height="20" fill="#fff" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} y={i * 3.08} width="20" height="1.54" fill="#d22f3b" />
      ))}
      <rect width="9.6" height="10.8" fill="#273b7d" />
      {[
        [2.4, 2.4],
        [5, 2.4],
        [7.4, 2.4],
        [3.6, 4.6],
        [6.2, 4.6],
        [2.4, 6.8],
        [5, 6.8],
        [7.4, 6.8],
        [3.6, 9],
        [6.2, 9],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r=".55" fill="#fff" />
      ))}
    </>
  ),
  de: (
    <>
      <rect width="20" height="6.7" fill="#1a1a1a" />
      <rect y="6.6" width="20" height="6.8" fill="#dd2a2a" />
      <rect y="13.3" width="20" height="6.7" fill="#ffcf2e" />
    </>
  ),
  gb: (
    <>
      <rect width="20" height="20" fill="#24357c" />
      <path d="M0 0 20 20M20 0 0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0 20 20M20 0 0 20" stroke="#d6303d" strokeWidth="1.4" />
      <path d="M10 0v20M0 10h20" stroke="#fff" strokeWidth="5.6" />
      <path d="M10 0v20M0 10h20" stroke="#d6303d" strokeWidth="3.2" />
    </>
  ),
  jp: (
    <>
      <rect width="20" height="20" fill="#fff" />
      <circle cx="10" cy="10" r="4.6" fill="#d6303d" />
    </>
  ),
  ca: (
    <>
      <rect width="20" height="20" fill="#fff" />
      <rect width="5" height="20" fill="#d6303d" />
      <rect x="15" width="5" height="20" fill="#d6303d" />
      <path d="M10 5.2 11 7.4l1.6-.6-.5 3 1.6-.8.3 1.2 1.3-.2-1 1.8.6.4L12 13.4l.3 1H10.4v2h-.8v-2H7.7l.3-1L6 12.2l.6-.4-1-1.8 1.3.2.3-1.2 1.6.8-.5-3 1.6.6Z" fill="#d6303d" />
    </>
  ),
  ae: (
    <>
      <rect width="20" height="6.7" fill="#00843d" />
      <rect y="6.6" width="20" height="6.8" fill="#fff" />
      <rect y="13.3" width="20" height="6.7" fill="#1a1a1a" />
      <rect width="5.6" height="20" fill="#d6303d" />
    </>
  ),
}

export function Flag({ code, size = 18 }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="flag" aria-hidden="true">
      <clipPath id={id}>
        <circle cx="10" cy="10" r="10" />
      </clipPath>
      <g clipPath={`url(#${id})`}>{FLAG_ART[code] ?? FLAG_ART.us}</g>
      <circle cx="10" cy="10" r="9.6" fill="none" stroke="rgba(0,0,0,.08)" strokeWidth=".8" />
    </svg>
  )
}

export function Mastercard({ size = 36 }) {
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 36 22" aria-hidden="true">
      <circle cx="11" cy="11" r="10" fill="#eb2a2a" />
      <circle cx="25" cy="11" r="10" fill="#f8a91d" fillOpacity=".95" />
      <path d="M18 3.9a10 10 0 0 1 0 14.2 10 10 0 0 1 0-14.2Z" fill="#fb6a1d" />
    </svg>
  )
}

const TILE = {
  salary: { bg: '#e3f6ea', fg: '#1f9d55', icon: 'arrowDown' },
  stream: { bg: '#fde7e7', fg: '#d93a3a', icon: 'play' },
  ride: { bg: '#1c1c1e', fg: '#ffffff', icon: 'car' },
  utility: { bg: '#fdf3d3', fg: '#c98a00', icon: 'bolt' },
  transfer: { bg: '#e7eefe', fg: '#3f6ff2', icon: 'transfer' },
  coffee: { bg: '#f3e8df', fg: '#8a5a3c', icon: 'coffee' },
  gym: { bg: '#efe8fd', fg: '#7a4ddc', icon: 'trophy' },
  send: { bg: 'var(--accent-soft)', fg: 'var(--accent)', icon: 'arrowUpRight' },
  request: { bg: '#e3f6ea', fg: '#1f9d55', icon: 'arrowDown' },
}

/** Merchant marks for the activity table. */
export function ActivityLogo({ kind, size = 22 }) {
  if (kind === 'appstore')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="as-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1bc2fb" />
            <stop offset="1" stopColor="#1e6ef2" />
          </linearGradient>
        </defs>
        <rect width="24" height="24" rx="6" fill="url(#as-g)" />
        <path d="M9.6 16.4 13.4 9.8m1.4 6.6-2.1-3.6M7.2 14.6h6.6m2.4 0h.8" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    )
  if (kind === 'hotel')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.5 5.5c4.6.4 8.4 2.6 10.6 6.4L21.5 4l-4.6 10.4c-1.2 2.7-3.4 4.6-6.4 5.1l1.3-3.9C8 14 4.7 10.4 2.5 5.5Z" fill="#1f3f91" />
      </svg>
    )
  if (kind === 'flight')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9.8 12 12l-2.6 8.4 3.8-1.6L21 4.2 3 9.8Z" fill="#3ba7f0" />
        <path d="M12 12 21 4.2l-7.8 14.6L12 12Z" fill="#f2547d" />
        <path d="M3 9.8 12 12 21 4.2 3 9.8Z" fill="#8fd16a" />
        <path d="m12 12-2.6 8.4 3.8-1.6L12 12Z" fill="#f7b731" />
      </svg>
    )
  if (kind === 'grocery')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <rect key={a} x="10.6" y="2.2" width="2.8" height="7" rx="1.4" fill="#f8c21c" transform={`rotate(${a} 12 12)`} />
        ))}
      </svg>
    )
  if (kind === 'software')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="5" fill="#eb1c24" />
        <path d="M9.4 5.5h-4v13l4-13Zm5.2 0h4v13l-4-13ZM12 10.2l2.6 8.3h-2.2L11.5 16H9.6L12 10.2Z" fill="#fff" />
      </svg>
    )
  const t = TILE[kind] ?? TILE.transfer
  return (
    <span className="tile-logo" style={{ width: size, height: size, background: t.bg, color: t.fg }}>
      <Icon name={t.icon} size={size * 0.62} stroke={2} />
    </span>
  )
}

/** Initials avatar for contacts, chats and invoices. */
export function Persona({ name, hue = 20, size = 40, brand = false }) {
  if (brand)
    return (
      <span className="persona brand" style={{ width: size, height: size }}>
        <Logo size={size} />
      </span>
    )
  return (
    <span
      className="persona"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(140deg, hsl(${hue} 85% 72%), hsl(${hue + 28} 70% 52%))`,
      }}
    >
      {initials(name)}
    </span>
  )
}
