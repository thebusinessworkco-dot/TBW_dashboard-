import { useLayoutEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import { PageHead, Toggle } from '../components/ui'
import { useApp } from '../lib/store'
import { CURRENCIES } from '../data/seed'

const TABS = [
  { id: 'general', icon: 'gear', label: 'General', body: 'Language, currency and region' },
  { id: 'notifications', icon: 'bell', label: 'Notifications', body: 'What we tell you, and how' },
  { id: 'security', icon: 'lock', label: 'Security', body: 'Password and devices' },
  { id: 'appearance', icon: 'palette', label: 'Appearance', body: 'Theme, accent and motion' },
]

const ACCENTS = [
  { id: 'orange', color: '#ef6537' },
  { id: 'blue', color: '#3d6ef5' },
  { id: 'green', color: '#14a06a' },
  { id: 'violet', color: '#7c4fe0' },
  { id: 'rose', color: '#e5407a' },
]

const NOTIFY = [
  { group: 'Email', items: [{ k: 'emailTx', l: 'Every transaction' }, { k: 'emailReport', l: 'Monthly report' }, { k: 'emailPromo', l: 'Offers and news' }] },
  { group: 'Push', items: [{ k: 'pushTx', l: 'Payments in and out' }, { k: 'pushSecurity', l: 'Security alerts' }, { k: 'pushReminders', l: 'Bill reminders' }] },
  { group: 'SMS', items: [{ k: 'smsSecurity', l: 'Sign-in codes' }, { k: 'smsLarge', l: 'Payments over $1,000' }] },
]

const strength = (pw) => {
  let s = 0
  if (pw.length >= 8) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  return s
}

function PasswordForm({ toast }) {
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const s = strength(pw)
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!cur || s < 3) return
        setCur('')
        setPw('')
        toast('Password updated', 'Other devices will be asked to sign in again.', { icon: 'lock' })
      }}
    >
      <label className="field">
        <span>Current password</span>
        <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
      </label>
      <label className="field">
        <span>New password</span>
        <div className="pw-wrap">
          <input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
            <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
          </button>
        </div>
        <div className={`pw-meter s${s}`}>
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={i < s ? 'on' : ''} />
          ))}
        </div>
        <small>{['Too short', 'Weak', 'Okay', 'Strong', 'Very strong'][s]} — use 8+ characters with numbers and symbols.</small>
      </label>
      <button type="submit" className="btn solid lg" disabled={!cur || s < 3}>
        Update password
      </button>
    </form>
  )
}

export default function Settings() {
  const app = useApp()
  const { prefs, setPrefs, currency, setCurrency, theme, switchTheme, accent, setAccent, reduceMotion, setReduceMotion, security, setSecurity, sessions, setSessions, toast, replayIntro } = app
  const [tab, setTab] = useState('general')
  const nav = useRef(null)
  const ind = useRef(null)

  useLayoutEffect(() => {
    const btn = nav.current?.querySelector(`[data-tab="${tab}"]`)
    if (!btn || !ind.current) return
    ind.current.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`
    ind.current.style.width = `${btn.offsetWidth}px`
    ind.current.style.height = `${btn.offsetHeight}px`
  }, [tab])

  const setPref = (k) => (e) => setPrefs((p) => ({ ...p, [k]: e.target.value }))
  const setNotify = (k, v) => setPrefs((p) => ({ ...p, notify: { ...p.notify, [k]: v } }))

  return (
    <>
      <PageHead title="Settings" sub="Make Vertix work the way you do." />

      <div className="settings-grid">
        <section className="card settings-nav" style={{ '--d': '0ms' }}>
          <nav ref={nav}>
            <span className="sn-ind" ref={ind} />
            {TABS.map((t, i) => (
              <button key={t.id} type="button" data-tab={t.id} className={`sn-item rv ${tab === t.id ? 'on' : ''}`} style={{ '--i': i }} onClick={() => setTab(t.id)}>
                <span className="control-ic">
                  <Icon name={t.icon} size={18} />
                </span>
                <span className="control-txt">
                  <strong>{t.label}</strong>
                  <small>{t.body}</small>
                </span>
              </button>
            ))}
          </nav>
        </section>

        <section className="card settings-panel" style={{ '--d': '90ms' }}>
          <div className="panel-body" key={tab}>
            {tab === 'general' ? (
              <>
                <h2 className="card-title big">General</h2>
                <p className="card-sub">These apply everywhere you use Vertix.</p>
                <div className="settings-form">
                  <label className="field">
                    <span>Language</span>
                    <select value={prefs.language} onChange={setPref('language')}>
                      {['English (US)', 'English (UK)', 'বাংলা', 'हिन्दी', 'اردو', 'Deutsch'].map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Default currency</span>
                    <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {Object.values(CURRENCIES).map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                    <small>Your dashboard balance is shown in this currency.</small>
                  </label>
                  <label className="field">
                    <span>Time zone</span>
                    <select value={prefs.timezone} onChange={setPref('timezone')}>
                      {['Asia/Dhaka (GMT+6)', 'Asia/Dubai (GMT+4)', 'Europe/London (GMT+1)', 'America/New_York (GMT-4)'].map((z) => (
                        <option key={z}>{z}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Week starts on</span>
                    <select value={prefs.weekStart} onChange={setPref('weekStart')}>
                      {['Monday', 'Sunday', 'Saturday'].map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="panel-foot">
                  <button type="button" className="btn solid lg" onClick={() => toast('Settings saved', 'Your preferences are up to date.')}>
                    Save changes
                  </button>
                </div>
              </>
            ) : null}

            {tab === 'notifications' ? (
              <>
                <h2 className="card-title big">Notifications</h2>
                <p className="card-sub">Pick what reaches you, and where.</p>
                {NOTIFY.map((g) => (
                  <div key={g.group} className="notify-group">
                    <h3 className="sub-title">{g.group}</h3>
                    {g.items.map((it) => (
                      <div key={it.k} className="control">
                        <span className="control-txt">
                          <strong>{it.l}</strong>
                        </span>
                        <Toggle on={prefs.notify[it.k]} label={`${g.group}: ${it.l}`} onChange={(v) => setNotify(it.k, v)} />
                      </div>
                    ))}
                  </div>
                ))}
              </>
            ) : null}

            {tab === 'security' ? (
              <>
                <h2 className="card-title big">Security</h2>
                <p className="card-sub">Keep your money locked down.</p>
                <div className="control boxed">
                  <span className="control-ic">
                    <Icon name="key" size={19} />
                  </span>
                  <span className="control-txt">
                    <strong>Two-factor authentication</strong>
                    <small>{security.twoFactor ? 'On — codes go to +880 •••• 678' : 'Off — we strongly recommend turning this on'}</small>
                  </span>
                  <Toggle on={security.twoFactor} label="Two-factor authentication" onChange={(v) => setSecurity((s) => ({ ...s, twoFactor: v }))} />
                </div>
                <h3 className="sub-title">Change password</h3>
                <PasswordForm toast={toast} />
                <h3 className="sub-title">Devices</h3>
                <div className="control boxed">
                  <span className="control-ic">
                    <Icon name="monitor" size={19} />
                  </span>
                  <span className="control-txt">
                    <strong>{sessions.length} signed-in devices</strong>
                    <small>Sign out everywhere except this MacBook.</small>
                  </span>
                  <button
                    type="button"
                    className="btn tiny danger"
                    disabled={sessions.length <= 1}
                    onClick={() => {
                      setSessions((list) => list.filter((s) => s.current))
                      toast('Signed out elsewhere', 'Only this device is still signed in.', { icon: 'logout' })
                    }}
                  >
                    Sign out others
                  </button>
                </div>
              </>
            ) : null}

            {tab === 'appearance' ? (
              <>
                <h2 className="card-title big">Appearance</h2>
                <p className="card-sub">Switching theme pours the new look over the page.</p>
                <h3 className="sub-title">Theme</h3>
                <div className="theme-cards">
                  {['light', 'dark'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`theme-card ${t} ${theme === t ? 'on' : ''}`}
                      onClick={(e) => switchTheme(t, { x: e.clientX, y: e.clientY })}
                    >
                      <span className="tc-preview">
                        <i />
                        <b />
                        <b />
                        <em />
                      </span>
                      <span className="tc-label">
                        <Icon name={t === 'light' ? 'sun' : 'moon'} size={16} />
                        {t === 'light' ? 'Light' : 'Dark'}
                        {theme === t ? <Icon name="check" size={15} stroke={2.4} className="tc-check" /> : null}
                      </span>
                    </button>
                  ))}
                </div>
                <h3 className="sub-title">Accent colour</h3>
                <div className="accents">
                  {ACCENTS.map((a) => (
                    <button key={a.id} type="button" className={`accent-dot ${accent === a.id ? 'on' : ''}`} style={{ '--c': a.color }} onClick={() => setAccent(a.id)} aria-label={`${a.id} accent`}>
                      {accent === a.id ? <Icon name="check" size={16} stroke={2.6} /> : null}
                    </button>
                  ))}
                </div>
                <h3 className="sub-title">Motion</h3>
                <div className="control boxed">
                  <span className="control-ic">
                    <Icon name="sparkle" size={19} />
                  </span>
                  <span className="control-txt">
                    <strong>Reduce motion</strong>
                    <small>Turn off entrance and theme animations.</small>
                  </span>
                  <Toggle on={reduceMotion} label="Reduce motion" onChange={setReduceMotion} />
                </div>
                <div className="control boxed">
                  <span className="control-ic">
                    <Icon name="replay" size={19} />
                  </span>
                  <span className="control-txt">
                    <strong>Intro animation</strong>
                    <small>Play the first-visit dashboard reveal again.</small>
                  </span>
                  <button type="button" className="btn tiny solid" onClick={replayIntro}>
                    <Icon name="play" size={13} />
                    Replay
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </>
  )
}
