import { useState } from 'react'
import Icon from '../components/Icon'
import { Empty, PageHead } from '../components/ui'
import { useApp } from '../lib/store'
import { FAQS, HELP_TOPICS } from '../data/seed'

const STATUS = ['Payments', 'Cards', 'Transfers', 'Mobile app']

export default function Help() {
  const { go, toast } = useApp()
  const [q, setQ] = useState('')
  const [topic, setTopic] = useState(null)
  const [open, setOpen] = useState('f1')

  const term = q.trim().toLowerCase()
  const faqs = FAQS.filter((f) => (!topic || f.topic === topic) && (!term || `${f.q} ${f.a}`.toLowerCase().includes(term)))

  return (
    <>
      <PageHead title="Help Center" sub="Answers, guides and real humans when you need them." />

      <section className="card help-hero" style={{ '--d': '0ms' }}>
        <div className="hh-glow" aria-hidden="true" />
        <h2 className="rv" style={{ '--i': 0 }}>
          How can we help, today?
        </h2>
        <label className="hh-search rv" style={{ '--i': 1 }}>
          <Icon name="search" size={20} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for answers — e.g. “freeze card”" aria-label="Search help" />
          {q ? (
            <button type="button" onClick={() => setQ('')} aria-label="Clear">
              <Icon name="close" size={15} />
            </button>
          ) : null}
        </label>
        <div className="hh-popular rv" style={{ '--i': 2 }}>
          <span>Popular:</span>
          {['pending', 'freeze', 'limit', '2FA'].map((p) => (
            <button key={p} type="button" onClick={() => setQ(p === '2FA' ? 'two-factor' : p)}>
              {p}
            </button>
          ))}
        </div>
      </section>

      <div className="topic-grid">
        {HELP_TOPICS.map((t, i) => (
          <button key={t.id} type="button" className={`card topic ${topic === t.id ? 'on' : ''}`} style={{ '--d': `${90 + i * 60}ms` }} onClick={() => setTopic((x) => (x === t.id ? null : t.id))}>
            <span className="topic-ic">
              <Icon name={t.icon} size={22} />
            </span>
            <strong>{t.id}</strong>
            <small>{t.body}</small>
            <em>{FAQS.filter((f) => f.topic === t.id).length} articles</em>
          </button>
        ))}
      </div>

      <div className="help-grid">
        <section className="card faq-card" style={{ '--d': '320ms' }}>
          <div className="section-head rv" style={{ '--i': 0 }}>
            <h2 className="card-title big">{topic ? `${topic} questions` : 'Frequently asked'}</h2>
            {topic || term ? (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setTopic(null)
                  setQ('')
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
          <div className="faqs">
            {faqs.length === 0 ? <Empty icon="help" title="No answers match" body="Try other words, or chat with us." /> : null}
            {faqs.map((f, i) => (
              <div key={f.id} className={`faq rv ${open === f.id ? 'open' : ''}`} style={{ '--i': i + 1 }}>
                <button type="button" className="faq-q" onClick={() => setOpen((o) => (o === f.id ? null : f.id))} aria-expanded={open === f.id}>
                  <span>{f.q}</span>
                  <i>
                    <Icon name="plus" size={16} stroke={2} />
                  </i>
                </button>
                <div className="faq-a">
                  <div>
                    <p>{f.a}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="help-side">
          <section className="card contact-card" style={{ '--d': '380ms' }}>
            <h2 className="card-title big rv" style={{ '--i': 0 }}>
              Still stuck?
            </h2>
            <p className="card-sub rv" style={{ '--i': 1 }}>
              Our team replies in under 3 minutes on average.
            </p>
            <button type="button" className="support-opt primary rv" style={{ '--i': 2 }} onClick={() => go('messages', { chat: 'support' })}>
              <span>
                <Icon name="chat" size={20} />
              </span>
              <span className="control-txt">
                <strong>Chat with support</strong>
                <small>Online now · avg. 3 min reply</small>
              </span>
              <Icon name="arrowRight" size={18} />
            </button>
            <button
              type="button"
              className="support-opt rv"
              style={{ '--i': 3 }}
              onClick={() => {
                navigator.clipboard?.writeText('support@vertix.app').catch(() => {})
                toast('Email copied', 'support@vertix.app', { icon: 'mail' })
              }}
            >
              <span>
                <Icon name="mail" size={20} />
              </span>
              <span className="control-txt">
                <strong>Email us</strong>
                <small>support@vertix.app</small>
              </span>
              <Icon name="copy" size={17} />
            </button>
            <button type="button" className="support-opt rv" style={{ '--i': 4 }} onClick={() => toast('Calling support…', '+880 9612 000 111 · 24/7', { icon: 'phone' })}>
              <span>
                <Icon name="phone" size={20} />
              </span>
              <span className="control-txt">
                <strong>Call us</strong>
                <small>24/7 · +880 9612 000 111</small>
              </span>
              <Icon name="arrowRight" size={18} />
            </button>
          </section>

          <section className="card status-card" style={{ '--d': '440ms' }}>
            <div className="section-head rv" style={{ '--i': 0 }}>
              <h2 className="card-title">System status</h2>
              <span className="live-dot">All good</span>
            </div>
            <ul className="status-list">
              {STATUS.map((s, i) => (
                <li key={s} className="rv" style={{ '--i': i + 1 }}>
                  <span>{s}</span>
                  <span className="uptime">
                    {Array.from({ length: 24 }, (_, j) => (
                      <i key={j} className={j === 17 && i === 2 ? 'warn' : ''} style={{ '--j': j }} />
                    ))}
                  </span>
                  <b>{i === 2 ? '99.96%' : '100%'}</b>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}
