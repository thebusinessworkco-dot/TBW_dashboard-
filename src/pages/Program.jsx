import { useState } from 'react'
import Icon from '../components/Icon'
import { CountUp, Modal, PageHead, Segmented } from '../components/ui'
import { useApp } from '../lib/store'
import { uid } from '../lib/format'
import { REWARDS } from '../data/seed'

const TIERS = {
  Silver: { min: 0, perks: ['1 point per $1 spent', 'Free card replacement', 'Monthly spending insights'] },
  Gold: { min: 5000, perks: ['1.5 points per $1 spent', '2 free airport lounge visits a year', 'Priority chat support', 'No FX fees up to $5k / month'] },
  Platinum: { min: 20000, perks: ['2 points per $1 spent', 'Unlimited lounge access', 'Dedicated account manager', 'No FX fees, ever', 'Travel insurance included'] },
}

const fmt = (n) => Math.round(n).toLocaleString('en-US')

function Redeem({ onClose }) {
  const { points, setPoints, toast } = useApp()
  return (
    <div className="redeem-list">
      {REWARDS.map((r, i) => {
        const short = points.total < r.cost
        return (
          <div key={r.id} className="redeem-row" style={{ '--i': i }}>
            <span className="control-ic">
              <Icon name={r.icon} size={19} />
            </span>
            <span className="control-txt">
              <strong>{r.title}</strong>
              <small>{fmt(r.cost)} pts</small>
            </span>
            <button
              type="button"
              className="btn solid tiny"
              disabled={short}
              onClick={() => {
                setPoints((p) => ({ total: p.total - r.cost, log: [{ id: uid(), title: `Redeemed — ${r.title}`, pts: -r.cost, date: 'Today' }, ...p.log] }))
                toast('Reward redeemed', `${r.title} is on its way.`, { icon: 'gift' })
                onClose()
              }}
            >
              {short ? `Need ${fmt(r.cost - points.total)}` : 'Redeem'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function Program() {
  const { points, offers, setOffers, toast, booting } = useApp()
  const [tier, setTier] = useState('Gold')
  const [redeem, setRedeem] = useState(false)
  const current = points.total >= 20000 ? 'Platinum' : points.total >= 5000 ? 'Gold' : 'Silver'
  const next = current === 'Silver' ? 'Gold' : 'Platinum'
  const span = TIERS[next].min - TIERS[current].min
  const progress = current === 'Platinum' ? 1 : (points.total - TIERS[current].min) / span
  const lead = booting ? 900 : 300

  return (
    <>
      <PageHead title="Rewards Program" sub="Earn points on every purchase and unlock better perks as you climb tiers." />

      <div className="program-grid">
        <section className="card points-hero" style={{ '--d': '0ms' }}>
          <div className="ph-glow" aria-hidden="true" />
          <div className="ph-top rv" style={{ '--i': 0 }}>
            <span className="ph-badge">
              <Icon name="crown" size={16} />
              {current} member
            </span>
            <span className="ph-id">Member since March 2021</span>
          </div>
          <div className="ph-points rv" style={{ '--i': 1 }}>
            <CountUp value={points.total} format={fmt} delay={lead} duration={1800} />
            <small>points</small>
          </div>
          <div className="ph-progress rv" style={{ '--i': 2 }}>
            <div className="ph-bar">
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="ph-legend">
              <span>{current}</span>
              <span>{current === 'Platinum' ? 'Top tier reached' : `${fmt(TIERS[next].min - points.total)} pts to ${next}`}</span>
            </div>
          </div>
          <div className="ph-actions rv" style={{ '--i': 3 }}>
            <button type="button" className="btn ph-btn" onClick={() => setRedeem(true)}>
              <Icon name="gift" size={18} />
              Redeem points
            </button>
            <span>≈ ${fmt(points.total / 100)} in rewards</span>
          </div>
        </section>

        <section className="card tiers-card" style={{ '--d': '90ms' }}>
          <div className="section-head rv" style={{ '--i': 0 }}>
            <h2 className="card-title big">Tier benefits</h2>
          </div>
          <div className="rv" style={{ '--i': 1 }}>
            <Segmented items={Object.keys(TIERS)} value={tier} onChange={setTier} />
          </div>
          <ul className="perks" key={tier}>
            {TIERS[tier].perks.map((p, i) => (
              <li key={p} style={{ '--i': i }}>
                <span>
                  <Icon name="check" size={14} stroke={2.4} />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <p className="tier-note rv" style={{ '--i': 7 }}>
            {tier === current ? 'This is your current tier.' : TIERS[tier].min > points.total ? `Unlocks at ${fmt(TIERS[tier].min)} points.` : 'You have already passed this tier.'}
          </p>
        </section>

        <section className="card offers-card" style={{ '--d': '180ms' }}>
          <div className="section-head rv" style={{ '--i': 0 }}>
            <div>
              <h2 className="card-title big">Offers for you</h2>
              <p className="card-sub">Activate an offer and it applies to your next eligible payment.</p>
            </div>
            <span className="pill-tag accent">{offers.filter((o) => o.active).length} active</span>
          </div>
          <div className="offers">
            {offers.map((o, i) => (
              <article key={o.id} className={`offer rv ${o.active ? 'active' : ''}`} style={{ '--i': i + 1 }}>
                <span className="offer-ic">
                  <Icon name={o.icon} size={22} />
                </span>
                <strong>{o.title}</strong>
                <p>{o.body}</p>
                <div className="offer-foot">
                  <small>{o.ends}</small>
                  <button
                    type="button"
                    className={`offer-btn ${o.active ? 'on' : ''}`}
                    onClick={() => {
                      setOffers((list) => list.map((x) => (x.id === o.id ? { ...x, active: !x.active } : x)))
                      if (!o.active) toast('Offer activated', o.title, { icon: 'sparkle' })
                    }}
                  >
                    {o.active ? (
                      <>
                        <Icon name="check" size={15} stroke={2.4} />
                        Activated
                      </>
                    ) : (
                      'Activate'
                    )}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card history-card" style={{ '--d': '260ms' }}>
          <div className="section-head rv" style={{ '--i': 0 }}>
            <h2 className="card-title big">Points history</h2>
          </div>
          <ul className="history">
            {points.log.map((p, i) => (
              <li key={p.id} className="rv" style={{ '--i': i + 1 }}>
                <span className={`hist-ic ${p.pts < 0 ? 'neg' : ''}`}>
                  <Icon name={p.pts < 0 ? 'gift' : 'star'} size={16} />
                </span>
                <span className="hist-txt">
                  <strong>{p.title}</strong>
                  <small>{p.date}</small>
                </span>
                <b className={p.pts < 0 ? 'neg' : 'pos'}>
                  {p.pts > 0 ? '+' : ''}
                  {fmt(p.pts)}
                </b>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Modal open={redeem} onClose={() => setRedeem(false)} title="Redeem points" sub={`You have ${fmt(points.total)} points to spend.`}>
        <Redeem onClose={() => setRedeem(false)} />
      </Modal>
    </>
  )
}
