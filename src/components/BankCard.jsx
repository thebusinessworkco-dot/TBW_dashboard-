import Icon from './Icon'
import { Mastercard } from './Brand'

const mask = (num) => `**** **** ${num.slice(-4)}`

/** A payment card. `flipped` turns it over to show the CVV strip. */
export default function BankCard({ card, flipped = false, reveal = false, big = false, onClick, style }) {
  const frozen = card.frozen
  return (
    <div
      className={`bank-card ${card.skin} ${big ? 'big' : ''} ${flipped ? 'flipped' : ''} ${frozen ? 'frozen' : ''}`}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      <div className="bc-inner">
        <div className="bc-face bc-front">
          <div className="bc-art" aria-hidden="true">
            {card.skin === 'onyx' ? (
              <>
                <i style={{ left: '52%', top: '8%' }} />
                <i style={{ left: '64%', top: '22%' }} />
                <i style={{ left: '40%', top: '30%' }} />
                <i style={{ left: '64%', top: '42%', opacity: 0.5 }} />
              </>
            ) : (
              <>
                <b className="spark s1" />
                <b className="spark s2" />
                <b className="spark s3" />
              </>
            )}
          </div>
          <div className="bc-top">
            <Icon name="contactless" size={big ? 22 : 18} stroke={1.8} />
            <span className="bc-pill">{frozen ? 'Frozen' : card.status}</span>
            <span className="bc-brand">
              <Mastercard size={big ? 44 : 34} />
            </span>
          </div>
          <div className="bc-bottom">
            <div>
              <small>Card Number</small>
              <strong>{reveal ? card.number : mask(card.number)}</strong>
            </div>
            <div>
              <small>EXP</small>
              <strong>{card.exp}</strong>
            </div>
            <div>
              <small>CVV</small>
              <strong>{card.cvv}</strong>
            </div>
          </div>
          {frozen ? (
            <div className="bc-frost" aria-hidden="true">
              <Icon name="snow" size={big ? 40 : 28} stroke={1.4} />
            </div>
          ) : null}
        </div>
        <div className="bc-face bc-back">
          <div className="bc-strip" />
          <div className="bc-sign">
            <span>{card.holder}</span>
            <b>{card.cvv}</b>
          </div>
          <p>This card is issued by Vertix. Use is subject to the cardholder agreement. If found, return to any Vertix partner.</p>
        </div>
      </div>
    </div>
  )
}
