import { useState } from 'react'
import Icon from '../components/Icon'
import BankCard from '../components/BankCard'
import { Flag } from '../components/Brand'
import { CountUp, PageHead, Toggle } from '../components/ui'
import { useApp } from '../lib/store'
import { money } from '../lib/format'

const CONTROLS = [
  { key: 'online', icon: 'globe', label: 'Online payments', body: 'Shops, subscriptions and in-app purchases' },
  { key: 'contactless', icon: 'contactless', label: 'Contactless', body: 'Tap to pay up to $250 per payment' },
  { key: 'atm', icon: 'bank', label: 'ATM withdrawals', body: 'Up to $1,000 per day' },
  { key: 'abroad', icon: 'plane', label: 'Use abroad', body: 'Payments outside Bangladesh' },
]

export default function Manage() {
  const { cards, setCards, spend, setSpend, wallets, setWallets, setWalletStatus, openModal, toast } = useApp()
  const [selId, setSelId] = useState(cards[0]?.id)
  const [flipped, setFlipped] = useState(false)
  const [reveal, setReveal] = useState(false)
  const card = cards.find((c) => c.id === selId) ?? cards[0]

  const patchCard = (patch) => setCards((list) => list.map((c) => (c.id === card.id ? { ...c, ...patch } : c)))
  const pct = Math.min(100, (spend.spent / spend.limit) * 100)

  const pick = (id) => {
    setSelId(id)
    setFlipped(false)
    setReveal(false)
  }

  return (
    <>
      <PageHead title="Manage" sub="Freeze cards, fine-tune limits and decide which wallets stay switched on.">
        <button type="button" className="btn solid lg" onClick={() => openModal('addCard')}>
          <Icon name="plus" size={18} />
          New card
        </button>
      </PageHead>

      <div className="manage-grid">
        <section className="card card-stage" style={{ '--d': '0ms' }}>
          <div className="section-head rv" style={{ '--i': 0 }}>
            <h2 className="card-title big">Your cards</h2>
            <span className="muted">{cards.length} cards</span>
          </div>

          <div className="stage rv" style={{ '--i': 1 }}>
            <BankCard key={card.id} card={card} big flipped={flipped} reveal={reveal} onClick={() => setFlipped((f) => !f)} />
            <p className="stage-hint">Tap the card to flip it</p>
          </div>

          <div className="card-picker rv" style={{ '--i': 2 }}>
            {cards.map((c) => (
              <button key={c.id} type="button" className={`pick ${c.skin} ${c.id === card.id ? 'on' : ''}`} onClick={() => pick(c.id)}>
                <i />
                •• {c.number.slice(-4)}
                {c.frozen ? <Icon name="snow" size={13} /> : null}
              </button>
            ))}
            <button type="button" className="pick add" onClick={() => openModal('addCard')} aria-label="Add card">
              <Icon name="plus" size={16} />
            </button>
          </div>

          <div className="card-actions rv" style={{ '--i': 3 }}>
            <button
              type="button"
              className={`ca ${card.frozen ? 'on' : ''}`}
              onClick={() => {
                patchCard({ frozen: !card.frozen })
                toast(card.frozen ? 'Card unfrozen' : 'Card frozen', `•••• ${card.number.slice(-4)} ${card.frozen ? 'works again' : 'will decline new payments'}.`, { icon: 'snow' })
              }}
            >
              <span>
                <Icon name="snow" size={20} />
              </span>
              {card.frozen ? 'Unfreeze' : 'Freeze'}
            </button>
            <button type="button" className={`ca ${reveal ? 'on' : ''}`} onClick={() => setReveal((r) => !r)}>
              <span>
                <Icon name={reveal ? 'eyeOff' : 'eye'} size={20} />
              </span>
              {reveal ? 'Hide number' : 'Show number'}
            </button>
            <button
              type="button"
              className="ca"
              onClick={() => {
                navigator.clipboard?.writeText(card.number.replace(/\s/g, '')).catch(() => {})
                toast('Card number copied', `•••• ${card.number.slice(-4)} is on your clipboard.`, { icon: 'copy' })
              }}
            >
              <span>
                <Icon name="copy" size={20} />
              </span>
              Copy number
            </button>
            <button type="button" className={`ca ${flipped ? 'on' : ''}`} onClick={() => setFlipped((f) => !f)}>
              <span>
                <Icon name="refresh" size={20} />
              </span>
              Flip card
            </button>
          </div>
        </section>

        <section className="card controls-card" style={{ '--d': '90ms' }}>
          <div className="section-head rv" style={{ '--i': 0 }}>
            <h2 className="card-title big">Card controls</h2>
            <span className={`pill-tag ${card.frozen ? 'blue' : 'green'}`}>{card.frozen ? 'Frozen' : 'Active'}</span>
          </div>
          <div className="control-list">
            {CONTROLS.map((c, i) => (
              <div key={c.key} className={`control rv ${card.frozen ? 'disabled' : ''}`} style={{ '--i': i + 1 }}>
                <span className="control-ic">
                  <Icon name={c.icon} size={19} />
                </span>
                <span className="control-txt">
                  <strong>{c.label}</strong>
                  <small>{c.body}</small>
                </span>
                <Toggle
                  on={!card.frozen && card.controls[c.key]}
                  label={c.label}
                  onChange={(v) => {
                    if (card.frozen) return toast('Card is frozen', 'Unfreeze it to change controls.', { icon: 'snow' })
                    patchCard({ controls: { ...card.controls, [c.key]: v } })
                  }}
                />
              </div>
            ))}
          </div>

          <div className="limit-editor rv" style={{ '--i': 6 }}>
            <div className="le-head">
              <span>Monthly spending limit</span>
              <strong>
                <CountUp value={spend.limit} format={(n) => money(Math.round(n / 100) * 100)} duration={500} />
              </strong>
            </div>
            <input
              type="range"
              min="1000"
              max="20000"
              step="500"
              value={spend.limit}
              style={{ '--p': `${((spend.limit - 1000) / 19000) * 100}%` }}
              onChange={(e) => setSpend((s) => ({ ...s, limit: Number(e.target.value) }))}
              aria-label="Monthly spending limit"
            />
            <div className="le-scale">
              <span>$1,000</span>
              <span>$20,000</span>
            </div>
            <div className="le-used">
              <div className="limit-bar">
                <span className={`limit-fill ${pct >= 90 ? 'warn' : ''}`} style={{ width: `${pct}%` }} />
              </div>
              <span>
                <b>{money(spend.spent)}</b> used · {Math.round(pct)}%
              </span>
            </div>
          </div>
        </section>

        <section className="card wallets-card" style={{ '--d': '180ms' }}>
          <div className="section-head rv" style={{ '--i': 0 }}>
            <div>
              <h2 className="card-title big">Wallets</h2>
              <p className="card-sub">Switch a currency off and incoming payments in it are held.</p>
            </div>
            <span className="muted">
              {wallets.filter((w) => w.status === 'active').length} of {wallets.length} active
            </span>
          </div>
          <div className="wallet-rows">
            {wallets.map((w, i) => (
              <div key={w.id} className={`wallet-row rv ${w.status}`} style={{ '--i': i + 1 }}>
                <Flag code={w.flag} size={34} />
                <span className="wr-name">
                  <strong>{w.code}</strong>
                  <small>Limit {w.limit} / month</small>
                </span>
                <strong className="wr-amt">
                  <CountUp value={w.amount} format={(n) => money(n, w.symbol)} duration={700} />
                </strong>
                <span className={`pill-tag ${w.status === 'active' ? 'green' : 'red'}`}>{w.status === 'active' ? 'Active' : 'Inactive'}</span>
                <button
                  type="button"
                  className="btn tiny"
                  disabled={w.status !== 'active'}
                  onClick={() => {
                    setWallets((list) => list.map((x) => (x.id === w.id ? { ...x, amount: x.amount + 500 } : x)))
                    toast(`${w.code} wallet topped up`, `${money(500, w.symbol)} added from your main balance.`, { icon: 'plus' })
                  }}
                >
                  <Icon name="plus" size={14} />
                  Top up
                </button>
                <Toggle on={w.status === 'active'} label={`${w.code} active`} onChange={(v) => setWalletStatus(w.id, v ? 'active' : 'inactive')} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
