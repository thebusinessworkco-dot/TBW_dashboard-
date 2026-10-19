import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'

import TopBar from './components/TopBar'
import SideRail from './components/SideRail'
import CommandPalette from './components/CommandPalette'
import { ActivityModal, AddCardModal, LogoutModal, RequestModal, TransferModal } from './components/Modals'
import { Toasts } from './components/ui'
import { Logo } from './components/Brand'

import Overview from './pages/Overview'
import Activity from './pages/Activity'
import Manage from './pages/Manage'
import Program from './pages/Program'
import Account from './pages/Account'
import Reports from './pages/Reports'
import Schedule from './pages/Schedule'
import Messages from './pages/Messages'
import Invoices from './pages/Invoices'
import Contacts from './pages/Contacts'
import Quotations from './pages/Quotations'
import Projects from './pages/Projects'
import Savings from './pages/Savings'
import Settings from './pages/Settings'
import Help from './pages/Help'
import LoginForm from './components/LoginForm'
import { api } from './lib/api'

import { AppContext } from './lib/store'
import { liquidSwitch } from './lib/themeTransition'
import { localIso, money, uid } from './lib/format'

const VIEWS = [
  { id: 'overview', label: 'Overview', rail: 'Dashboard', icon: 'category', page: Overview },
  { id: 'activity', label: 'Activity', icon: 'refresh', page: Activity },
  { id: 'manage', label: 'Manage', icon: 'card', page: Manage },
  { id: 'program', label: 'Program', icon: 'gift', page: Program },
  { id: 'account', label: 'Account', icon: 'user', page: Account },
  { id: 'reports', label: 'Reports', icon: 'chart', page: Reports },
  { id: 'schedule', label: 'Schedule', icon: 'calendar', page: Schedule },
  { id: 'messages', label: 'Messages', icon: 'mail', page: Messages },
  { id: 'invoices', label: 'Invoices', icon: 'note', page: Invoices },
  { id: 'contacts', label: 'CRM & Leads', icon: 'users', page: Contacts },
  { id: 'quotations', label: 'Quotations', icon: 'receipt', page: Quotations },
  { id: 'projects', label: 'Projects & Tasks', icon: 'layers', page: Projects },
  { id: 'savings', label: 'Profitability', icon: 'trend', page: Savings },
  { id: 'settings', label: 'Settings', icon: 'gear', page: Settings },
  { id: 'help', label: 'Help Center', icon: 'help', page: Help },
]

/** One page. Marks itself "settled" once its entrance has played, so content added later animates in quickly. */
function Main({ page: Page, booting }) {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(true), booting ? 3000 : 1700)
    return () => window.clearTimeout(t)
  }, [booting])
  return (
    <main className={`main ${settled ? 'settled' : ''}`} style={{ '--base': booting ? '520ms' : '0ms' }}>
      <Page />
    </main>
  )
}

const viewFromHash = () => {
  const id = window.location.hash.replace('#/', '').replace('#', '')
  return VIEWS.some((v) => v.id === id) ? id : 'overview'
}

const stored = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

const store = (key, value) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode — preferences just will not persist */
  }
}

export default function App() {
  /* ---------- appearance ---------- */
  const [theme, setTheme] = useState(() => stored('vertix-theme', 'light'))
  const [accent, setAccent] = useState(() => stored('vertix-accent', 'orange'))
  const [reduceMotion, setReduceMotion] = useState(() => stored('vertix-motion', 'full') === 'reduced')

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    store('vertix-theme', theme)
  }, [theme])
  useLayoutEffect(() => {
    document.documentElement.dataset.accent = accent
    store('vertix-accent', accent)
  }, [accent])
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = reduceMotion ? 'reduced' : 'full'
    store('vertix-motion', reduceMotion ? 'reduced' : 'full')
  }, [reduceMotion])

  const switchTheme = useCallback(
    (next, origin) => {
      if (next === theme) return
      const x = origin?.x ?? window.innerWidth / 2
      const y = origin?.y ?? 0
      liquidSwitch(x, y, () => {
        document.documentElement.dataset.theme = next
        flushSync(() => setTheme(next))
      })
    },
    [theme],
  )

  /* ---------- intro choreography (plays on every fresh load) ---------- */
  const [bootKey, setBootKey] = useState(0)
  const [booting, setBooting] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setBooting(false), 3200)
    return () => window.clearTimeout(t)
  }, [bootKey])

  /* ---------- routing ---------- */
  const [view, setView] = useState(viewFromHash)
  const [params, setParams] = useState({})
  useEffect(() => {
    const onHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = useCallback((id, p = {}) => {
    setParams(p)
    setView(id)
    if (window.location.hash !== `#/${id}`) window.history.pushState(null, '', `#/${id}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  /* ---------- data (zero dummy data in production) ---------- */
  const [user, setUser] = useState(null)
  const [currency, setCurrency] = useState('INR')
  const [balance, setBalance] = useState(0)
  const [wallets, setWallets] = useState([])
  const [activities, setActivities] = useState([])
  const [cards, setCards] = useState([])
  const [spend, setSpend] = useState({ spent: 0, limit: 0 })
  const [notifications, setNotifications] = useState([])
  const [contacts, setContacts] = useState([])
  const [conversations, setConversations] = useState([])
  const [invoices, setInvoices] = useState([])
  const [events, setEvents] = useState([])
  const [goals, setGoals] = useState([])
  const [autosave, setAutosave] = useState([])
  const [offers, setOffers] = useState([])
  const [points, setPoints] = useState({ total: 0, log: [] })
  const [banks, setBanks] = useState([])
  const [sessions, setSessions] = useState([])
  const [security, setSecurity] = useState({ twoFactor: true, biometric: true, alerts: true })
  const [prefs, setPrefs] = useState({
    language: 'English (US)',
    timezone: 'Asia/Kolkata (GMT+5:30)',
    dateFormat: 'DD MMM, YYYY',
    weekStart: 'Monday',
    notify: {
      emailTx: true,
      emailReport: true,
      emailPromo: false,
      pushTx: true,
      pushSecurity: true,
      pushReminders: true,
      smsSecurity: true,
      smsLarge: false,
    },
  })

  /* ---------- toasts ---------- */
  const [toasts, setToasts] = useState([])
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (title, body, opts = {}) => {
      const id = uid()
      setToasts((t) => [...t.slice(-3), { id, title, body, ...opts }])
      window.setTimeout(() => dismiss(id), opts.ms ?? 3400)
    },
    [dismiss],
  )

  /* ---------- modals & overlays ---------- */
  const [modal, setModal] = useState(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const openModal = useCallback((type, payload = {}) => setModal({ type, payload }), [])
  const closeModal = useCallback(() => setModal(null), [])
  const [signedOut, setSignedOut] = useState(() => !localStorage.getItem('tbw_token'))
  const [authChecking, setAuthChecking] = useState(() => !!localStorage.getItem('tbw_token'))

  useEffect(() => {
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  /* ---------- actions shared across pages ---------- */
  const nextActivityRef = useCallback(
    (list) => {
      const max = Math.max(...list.map((a) => Number(a.id.replace(/\D/g, '')) || 0))
      return `ACT_${String(max + 1).padStart(6, '0')}`
    },
    [],
  )

  const addActivity = useCallback(
    (row) =>
      setActivities((list) => [
        { key: uid(), id: nextActivityRef(list), date: localIso(), category: 'Transfer', ...row },
        ...list,
      ]),
    [nextActivityRef],
  )

  const sendMoney = useCallback(
    ({ to, amount, note, logo = 'send' }) => {
      setBalance((b) => b - amount)
      setSpend((s) => ({ ...s, spent: s.spent + amount }))
      addActivity({ title: `Transfer to ${to}`, logo, price: amount, status: 'Completed', dir: 'out', note })
      setNotifications((n) => [
        { id: uid(), icon: 'arrowUpRight', tone: 'accent', title: `You sent ${money(amount)}`, body: `To ${to}`, time: 'Just now', unread: true },
        ...n,
      ])
      toast('Transfer sent', `${money(amount)} is on its way to ${to}.`, { icon: 'send' })
    },
    [addActivity, toast],
  )

  const requestMoney = useCallback(
    ({ from, amount, note }) => {
      addActivity({ title: `Request from ${from}`, logo: 'request', price: amount, status: 'Pending', dir: 'in', note })
      toast('Request sent', `${from} will get a request for ${money(amount)}.`, { icon: 'arrowDown' })
    },
    [addActivity, toast],
  )

  const updateActivity = useCallback(
    (keys, patch) => setActivities((list) => list.map((a) => (keys.includes(a.key) ? { ...a, ...patch } : a))),
    [],
  )
  const removeActivities = useCallback((keys) => setActivities((list) => list.filter((a) => !keys.includes(a.key))), [])

  const setWalletStatus = useCallback(
    (id, status) => {
      setWallets((w) => w.map((x) => (x.id === id ? { ...x, status } : x)))
      const w = wallets.find((x) => x.id === id)
      toast(`${w?.code} wallet ${status === 'active' ? 'activated' : 'deactivated'}`, status === 'active' ? 'You can send and receive in this currency again.' : 'Incoming payments will be held until you reactivate it.', {
        icon: status === 'active' ? 'check' : 'lock',
      })
    },
    [wallets, toast],
  )

  /* Check existing authentication on load */
  useEffect(() => {
    const token = localStorage.getItem('tbw_token')
    if (!token) {
      setSignedOut(true)
      setAuthChecking(false)
      setUser(null)
      return
    }

    api.get('/api/auth/me')
      .then(res => {
        if (res.success && res.data?.user) {
          setUser(u => ({ ...(u || {}), ...res.data.user, first: res.data.user.name.split(' ')[0] }))
          setSignedOut(false)
        } else {
          setSignedOut(true)
          setUser(null)
        }
      })
      .catch(() => {
        setSignedOut(true)
        setUser(null)
      })
      .finally(() => {
        setAuthChecking(false)
      })

    const handleAuthExpired = () => {
      setSignedOut(true)
      setUser(null)
      setAuthChecking(false)
      toast('Session Expired', 'Your session has expired. Please log in again.', { icon: 'lock' })
    }
    window.addEventListener('tbw_auth_expired', handleAuthExpired)
    return () => window.removeEventListener('tbw_auth_expired', handleAuthExpired)
  }, [toast])

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } catch {}
    localStorage.removeItem('tbw_token')
    setModal(null)
    setSignedOut(true)
  }, [])

  const handleLoginSuccess = useCallback((authedUser) => {
    setUser(u => ({ ...u, ...authedUser, first: authedUser.name.split(' ')[0] }))
    setSignedOut(false)
    setBooting(true)
    setBootKey((k) => k + 1)
    go('overview')
  }, [go])

  const signIn = useCallback(() => {
    setSignedOut(false)
    setBooting(true)
    setBootKey((k) => k + 1)
    go('overview')
  }, [go])
  const replayIntro = useCallback(() => {
    setBooting(true)
    setBootKey((k) => k + 1)
    go('overview')
  }, [go])

  const ctx = useMemo(
    () => ({
      view,
      params,
      go,
      booting,
      theme,
      switchTheme,
      accent,
      setAccent,
      reduceMotion,
      setReduceMotion,
      replayIntro,
      user,
      setUser,
      currency,
      setCurrency,
      balance,
      setBalance,
      wallets,
      setWallets,
      setWalletStatus,
      activities,
      addActivity,
      updateActivity,
      removeActivities,
      cards,
      setCards,
      spend,
      setSpend,
      notifications,
      setNotifications,
      contacts,
      setContacts,
      conversations,
      setConversations,
      invoices,
      setInvoices,
      events,
      setEvents,
      goals,
      setGoals,
      autosave,
      setAutosave,
      offers,
      setOffers,
      points,
      setPoints,
      banks,
      setBanks,
      sessions,
      setSessions,
      security,
      setSecurity,
      prefs,
      setPrefs,
      sendMoney,
      requestMoney,
      toast,
      openModal,
      openPalette: () => setPaletteOpen(true),
      signOut,
    }),
    [
      view, params, go, booting, theme, switchTheme, accent, reduceMotion, replayIntro, user, currency, balance, wallets,
      setWalletStatus, activities, addActivity, updateActivity, removeActivities, cards, spend, notifications, contacts,
      conversations, invoices, events, goals, autosave, offers, points, banks, sessions, security, prefs, sendMoney,
      requestMoney, toast, openModal, signOut,
    ],
  )

  const page = (VIEWS.find((v) => v.id === view) ?? VIEWS[0]).page

  if (authChecking) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg, #0b0f19)',
        color: 'var(--fg, #f8fafc)',
        fontFamily: 'Inter, -apple-system, sans-serif'
      }}>
        <div style={{
          width: 44,
          height: 44,
          border: '3px solid rgba(255,255,255,0.1)',
          borderTopColor: '#ff5c00',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }} />
        <div style={{ marginTop: 16, fontSize: '0.9rem', color: '#94a3b8', letterSpacing: '0.05em' }}>
          VERIFYING SESSION...
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (signedOut || !user) {
    return <LoginForm onLoginSuccess={handleLoginSuccess} />
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className={`shell ${booting ? 'booting' : ''}`} key={bootKey}>
        <TopBar />
        <div className="frame">
          <SideRail />
          <Main key={view} page={page} booting={booting} />
        </div>
      </div>

      <TransferModal open={modal?.type === 'transfer'} payload={modal?.payload} onClose={closeModal} />
      <RequestModal open={modal?.type === 'request'} payload={modal?.payload} onClose={closeModal} />
      <AddCardModal open={modal?.type === 'addCard'} onClose={closeModal} />
      <ActivityModal open={modal?.type === 'activity'} payload={modal?.payload} onClose={closeModal} />
      <LogoutModal open={modal?.type === 'logout'} onClose={closeModal} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} views={VIEWS} />
      <Toasts items={toasts} onDismiss={dismiss} />
    </AppContext.Provider>
  )
}
