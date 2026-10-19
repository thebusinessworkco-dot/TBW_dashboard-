import { useState } from 'react'
import Icon from './Icon'
import BankCard from './BankCard'
import { ActivityLogo, Persona } from './Brand'
import { Modal, Segmented, Status } from './ui'
import { useApp } from '../lib/store'
import { money, stamp, uid } from '../lib/format'
import { saveFile } from '../lib/csv'

const QUICK = [50, 100, 250, 500, 1000]

function Success({ title, body, onDone }) {
  return (
    <div className="success">
      <svg viewBox="0 0 80 80" className="success-mark" aria-hidden="true">
        <circle cx="40" cy="40" r="34" />
        <path d="m26 41 9.5 9.5L55 31" />
      </svg>
      <h4>{title}</h4>
      <p>{body}</p>
      <button type="button" className="btn solid lg block" onClick={onDone}>
        Done
      </button>
    </div>
  )
}

function MoneyForm({ mode, initial, onClose }) {
  const { contacts, balance, sendMoney, requestMoney } = useApp()
  const [who, setWho] = useState(initial?.to ?? initial?.from ?? '')
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : '')
  const [note, setNote] = useState('')
  const [done, setDone] = useState(false)
  const value = Number(amount)
  const tooMuch = mode === 'send' && value > balance
  const valid = who.trim() && value > 0 && !tooMuch

  const submit = (e) => {
    e.preventDefault()
    if (!valid) return
    if (mode === 'send') sendMoney({ to: who.trim(), amount: value, note })
    else requestMoney({ from: who.trim(), amount: value, note })
    setDone(true)
  }

  if (done)
    return (
      <Success
        title={mode === 'send' ? 'Money sent' : 'Request sent'}
        body={mode === 'send' ? `${money(value)} is on its way to ${who}.` : `${who} will be asked to pay ${money(value)}.`}
        onDone={onClose}
      />
    )

  const favs = contacts.filter((c) => c.fav)
  return (
    <form onSubmit={submit} className="form">
      <div className="field">
        <span>{mode === 'send' ? 'Send to' : 'Request from'}</span>
        <div className="quick-people">
          {favs.map((c) => (
            <button key={c.id} type="button" className={`qp ${who === c.name ? 'on' : ''}`} onClick={() => setWho(c.name)}>
              <Persona name={c.name} hue={c.hue} size={38} />
              <small>{c.name.split(' ')[0]}</small>
            </button>
          ))}
        </div>
        <input list="contact-names" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Name, @handle or IBAN" />
        <datalist id="contact-names">
          {contacts.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
      </div>
      <label className="field">
        <span>Amount</span>
        <div className={`amount-input ${tooMuch ? 'bad' : ''}`}>
          <b>$</b>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
          <em>USD</em>
        </div>
        {tooMuch ? <small className="err">That is more than your available balance.</small> : <small>Available balance {money(balance)}</small>}
      </label>
      <div className="chips">
        {QUICK.map((q) => (
          <button key={q} type="button" className={`chip ${value === q ? 'on' : ''}`} onClick={() => setAmount(String(q))}>
            ${q}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What’s it for?" />
      </label>
      <button type="submit" className="btn solid lg block" disabled={!valid}>
        <Icon name={mode === 'send' ? 'transfer' : 'arrowDown'} size={19} />
        {mode === 'send' ? `Send ${value > 0 ? money(value) : ''}` : `Request ${value > 0 ? money(value) : ''}`}
      </button>
    </form>
  )
}

export function TransferModal({ open, payload, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Transfer money" sub="Instant between Vertix accounts, 1–2 days to other banks.">
      {open ? <MoneyForm key={JSON.stringify(payload)} mode="send" initial={payload} onClose={onClose} /> : null}
    </Modal>
  )
}

export function RequestModal({ open, payload, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Request money" sub="We’ll send them a secure link to pay you.">
      {open ? <MoneyForm key={JSON.stringify(payload)} mode="request" initial={payload} onClose={onClose} /> : null}
    </Modal>
  )
}

const SKINS = [
  { key: 'onyx', label: 'Onyx' },
  { key: 'ember', label: 'Ember' },
  { key: 'ocean', label: 'Ocean' },
  { key: 'forest', label: 'Forest' },
  { key: 'violet', label: 'Violet' },
]

const randomDigits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')

function AddCardForm({ onClose }) {
  const { user, setCards, toast } = useApp()
  const [skin, setSkin] = useState('ocean')
  const [kind, setKind] = useState('Virtual')
  const [holder, setHolder] = useState(user.name)
  const [draft] = useState(() => ({
    number: `5${randomDigits(3)} ${randomDigits(4)} ${randomDigits(4)} ${randomDigits(4)}`,
    cvv: randomDigits(3),
  }))
  const preview = {
    id: 'preview',
    skin,
    holder,
    number: draft.number,
    exp: '10/31',
    cvv: draft.cvv,
    status: 'Active',
    frozen: false,
  }
  const submit = (e) => {
    e.preventDefault()
    setCards((c) => [
      ...c,
      { ...preview, id: uid(), controls: { online: true, contactless: kind === 'Physical', atm: kind === 'Physical', abroad: false } },
    ])
    toast(`${kind} card added`, `Card •••• ${draft.number.slice(-4)} is ready to use.`, { icon: 'card' })
    onClose()
  }
  return (
    <form className="form" onSubmit={submit}>
      <div className="add-card-preview">
        <BankCard card={preview} />
      </div>
      <div className="field">
        <span>Card type</span>
        <Segmented items={['Virtual', 'Physical']} value={kind} onChange={setKind} />
      </div>
      <div className="field">
        <span>Finish</span>
        <div className="skins">
          {SKINS.map((s) => (
            <button key={s.key} type="button" className={`skin ${s.key} ${skin === s.key ? 'on' : ''}`} onClick={() => setSkin(s.key)} aria-label={s.label} title={s.label} />
          ))}
        </div>
      </div>
      <label className="field">
        <span>Name on card</span>
        <input value={holder} onChange={(e) => setHolder(e.target.value)} />
      </label>
      <button type="submit" className="btn solid lg block" disabled={!holder.trim()}>
        <Icon name="plus" size={18} />
        Create card
      </button>
    </form>
  )
}

export function AddCardModal({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Add a new card" sub="Virtual cards are ready instantly. Physical cards ship in 3–5 days." width={480}>
      {open ? <AddCardForm onClose={onClose} /> : null}
    </Modal>
  )
}

export function ActivityModal({ open, payload, onClose }) {
  const { activities, updateActivity, removeActivities, toast } = useApp()
  const a = open ? activities.find((x) => x.key === payload?.key) : null
  return (
    <Modal open={open && !!a} onClose={onClose} title="Transaction details" width={440}>
      {a ? (
        <div className="receipt">
          <div className="receipt-top">
            <span className="receipt-logo">
              <ActivityLogo kind={a.logo} size={30} />
            </span>
            <h4>{a.title}</h4>
            <strong className={a.dir === 'in' ? 'pos' : ''}>
              {a.dir === 'in' ? '+' : '-'}
              {money(a.price)}
            </strong>
            <Status value={a.status} />
          </div>
          <dl>
            <div>
              <dt>Order ID</dt>
              <dd>{a.id}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{stamp(a.date)}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{a.category}</dd>
            </div>
            <div>
              <dt>Paid with</dt>
              <dd>{a.dir === 'in' ? 'USD wallet' : 'Card •••• 6782'}</dd>
            </div>
            {a.note ? (
              <div>
                <dt>Note</dt>
                <dd>{a.note}</dd>
              </div>
            ) : null}
          </dl>
          <div className="receipt-actions">
            {a.status !== 'Completed' ? (
              <button
                type="button"
                className="btn solid"
                onClick={() => {
                  updateActivity([a.key], { status: 'Completed' })
                  toast('Marked as completed', a.title)
                }}
              >
                <Icon name="check" size={17} />
                Mark completed
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              onClick={() =>
                saveFile(
                  `${a.id}-receipt.txt`,
                  `VERTIX RECEIPT\n\n${a.title}\nOrder: ${a.id}\nAmount: ${money(a.price)}\nStatus: ${a.status}\nDate: ${stamp(a.date)}\n`,
                )
              }
            >
              <Icon name="download" size={17} />
              Receipt
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                removeActivities([a.key])
                toast('Transaction removed', a.title, { icon: 'trash' })
                onClose()
              }}
            >
              <Icon name="trash" size={17} />
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

export function LogoutModal({ open, onClose }) {
  const { signOut, user } = useApp()
  return (
    <Modal open={open} onClose={onClose} title="Log out of Vertix?" width={400}>
      <div className="logout-body">
        <span className="logout-ic">
          <Icon name="logout" size={26} />
        </span>
        <p>You’re signed in as {user.email}. You’ll need your password and 2FA code to sign back in.</p>
        <div className="row-btns">
          <button type="button" className="btn lg" onClick={onClose}>
            Stay signed in
          </button>
          <button type="button" className="btn solid lg" onClick={signOut}>
            Log out
          </button>
        </div>
      </div>
    </Modal>
  )
}
