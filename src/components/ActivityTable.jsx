import { useMemo, useState } from 'react'
import Icon from './Icon'
import { ActivityLogo } from './Brand'
import { Checkbox, Empty, MenuItem, Popover, Segmented, Status } from './ui'
import { useApp } from '../lib/store'
import { money, stamp } from '../lib/format'
import { saveFile, toCsv } from '../lib/csv'

const STATUSES = ['Completed', 'Pending', 'In Progress']

function SortHead({ full, sort, by, onSort, children }) {
  if (!full) return children
  return (
    <button type="button" className={`th-sort ${sort.by === by ? 'on' : ''}`} onClick={() => onSort(by)}>
      {children}
      <Icon name={sort.by === by && sort.dir === 'asc' ? 'chevUp' : 'chevDown'} size={14} stroke={2} />
    </button>
  )
}

function RowMenu({ row }) {
  const { openModal, updateActivity, removeActivities, toast } = useApp()
  const [open, setOpen] = useState(false)
  return (
    <div className="anchor">
      <button
        type="button"
        className={`row-dots ${open ? 'on' : ''}`}
        aria-label="Row actions"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <Icon name="dotsH" size={20} stroke={2.6} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="row-pop">
        <MenuItem icon="eye" onClick={() => (setOpen(false), openModal('activity', { key: row.key }))}>
          View details
        </MenuItem>
        {row.status !== 'Completed' ? (
          <MenuItem
            icon="check"
            onClick={() => {
              setOpen(false)
              updateActivity([row.key], { status: 'Completed' })
              toast('Marked as completed', row.title)
            }}
          >
            Mark as completed
          </MenuItem>
        ) : null}
        <MenuItem
          icon="trash"
          tone="danger"
          onClick={() => {
            setOpen(false)
            removeActivities([row.key])
            toast('Transaction removed', row.title, { icon: 'trash' })
          }}
        >
          Delete
        </MenuItem>
      </Popover>
    </div>
  )
}

export default function ActivityTable({ variant = 'compact', initialSelected = [] }) {
  const { activities, openModal, updateActivity, removeActivities, toast } = useApp()
  const full = variant === 'full'
  const [q, setQ] = useState('')
  const [statuses, setStatuses] = useState(STATUSES)
  const [tab, setTab] = useState('All')
  const [sort, setSort] = useState({ by: null, dir: 'desc' })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(initialSelected)
  const [filterOpen, setFilterOpen] = useState(false)
  const pageSize = 8

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    let rows = activities.filter((a) => !term || a.title.toLowerCase().includes(term) || a.id.toLowerCase().includes(term))
    rows = full ? rows.filter((a) => tab === 'All' || a.status === tab) : rows.filter((a) => statuses.includes(a.status))
    if (sort.by) {
      const k = sort.by
      rows = [...rows].sort((a, b) => {
        const va = k === 'date' ? new Date(a.date).getTime() : a[k]
        const vb = k === 'date' ? new Date(b.date).getTime() : b[k]
        return sort.dir === 'asc' ? va - vb : vb - va
      })
    }
    return rows
  }, [activities, q, statuses, tab, sort, full])

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages)
  const rows = full ? filtered.slice((current - 1) * pageSize, current * pageSize) : filtered.slice(0, 5)
  const visibleKeys = rows.map((r) => r.key)
  const live = selected.filter((k) => activities.some((a) => a.key === k))
  const allOn = rows.length > 0 && visibleKeys.every((k) => live.includes(k))
  const someOn = visibleKeys.some((k) => live.includes(k))

  const toggleAll = () => setSelected(allOn ? live.filter((k) => !visibleKeys.includes(k)) : [...new Set([...live, ...visibleKeys])])
  const toggle = (k) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))
  const sortBy = (by) => setSort((s) => (s.by === by ? { by, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { by, dir: 'desc' }))

  const counts = STATUSES.reduce((m, s) => ({ ...m, [s]: activities.filter((a) => a.status === s).length }), {})

  const exportCsv = () => {
    saveFile('vertix-activity.csv', toCsv(filtered), 'text/csv')
    toast('Export ready', `${filtered.length} transactions saved as CSV.`, { icon: 'download' })
  }

  return (
    <>
      <div className={`act-head ${full ? 'full' : ''}`}>
        {full ? (
          <Segmented
            items={[{ key: 'All', label: 'All', count: activities.length }, ...STATUSES.map((s) => ({ key: s, label: s, count: counts[s] }))]}
            value={tab}
            onChange={(t) => {
              setTab(t)
              setPage(1)
            }}
          />
        ) : (
          <h2 className="card-title big rv" style={{ '--i': 0 }}>
            Recent Activities
          </h2>
        )}
        <div className="act-tools rv" style={{ '--i': 1 }}>
          <label className="search-box">
            <Icon name="search" size={19} />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              placeholder="Search"
              aria-label="Search activities"
            />
            {q ? (
              <button type="button" onClick={() => setQ('')} aria-label="Clear search">
                <Icon name="close" size={14} />
              </button>
            ) : null}
          </label>
          {full ? (
            <button type="button" className="ghost-btn" onClick={exportCsv}>
              Export
              <Icon name="download" size={18} />
            </button>
          ) : (
            <div className="anchor">
              <button type="button" className={`ghost-btn ${filterOpen ? 'on' : ''}`} onClick={() => setFilterOpen((o) => !o)}>
                Filter
                <Icon name="filter" size={19} />
                {statuses.length < STATUSES.length ? <i className="filter-dot" /> : null}
              </button>
              <Popover open={filterOpen} onClose={() => setFilterOpen(false)} className="filter-pop">
                <h6>Status</h6>
                {STATUSES.map((s) => (
                  <label key={s} className="filter-row">
                    <Checkbox
                      checked={statuses.includes(s)}
                      onChange={() => setStatuses((st) => (st.includes(s) ? st.filter((x) => x !== s) : [...st, s]))}
                      label={s}
                    />
                    <Status value={s} />
                    <em>{counts[s]}</em>
                  </label>
                ))}
                <h6>Sort by</h6>
                <div className="filter-sorts">
                  {[
                    { by: null, label: 'Latest' },
                    { by: 'price', label: 'Price' },
                    { by: 'date', label: 'Date' },
                  ].map((o) => (
                    <button key={o.label} type="button" className={`chip ${sort.by === o.by ? 'on' : ''}`} onClick={() => setSort({ by: o.by, dir: 'desc' })}>
                      {o.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setStatuses(STATUSES)
                    setSort({ by: null, dir: 'desc' })
                  }}
                >
                  Reset filters
                </button>
              </Popover>
            </div>
          )}
        </div>
      </div>

      <div className="table rv" style={{ '--i': 2 }} role="table" aria-label="Activities">
        <div className="tr th" role="row">
          <span role="columnheader">
            <Checkbox checked={allOn} mixed={full && !allOn && someOn} onChange={toggleAll} label="Select all" />
          </span>
          <span role="columnheader">Order ID</span>
          <span role="columnheader">Activity</span>
          <span role="columnheader">
            <SortHead full={full} sort={sort} by="price" onSort={sortBy}>Price</SortHead>
          </span>
          <span role="columnheader">Status</span>
          <span role="columnheader">
            <SortHead full={full} sort={sort} by="date" onSort={sortBy}>Date</SortHead>
          </span>
          <span role="columnheader" />
        </div>
        {rows.length === 0 ? <Empty title="No activities found" body="Try a different search or filter." /> : null}
        {rows.map((r, i) => (
          <div
            key={r.key}
            role="row"
            className={`tr row ${live.includes(r.key) ? 'sel' : ''}`}
            style={{ '--r': i }}
            onClick={() => openModal('activity', { key: r.key })}
          >
            <span role="cell">
              <Checkbox checked={live.includes(r.key)} onChange={() => toggle(r.key)} label={`Select ${r.id}`} />
            </span>
            <span role="cell" className="mono">
              {r.id}
            </span>
            <span role="cell" className="act-cell">
              <ActivityLogo kind={r.logo} size={21} />
              <span>{r.title}</span>
            </span>
            <span role="cell" className={r.dir === 'in' && full ? 'pos' : ''}>
              {full && r.dir === 'in' ? '+' : ''}
              {money(r.price, '$', 0)}
            </span>
            <span role="cell">
              <Status value={r.status} />
            </span>
            <span role="cell">{stamp(r.date)}</span>
            <span role="cell" onClick={(e) => e.stopPropagation()}>
              <RowMenu row={r} />
            </span>
          </div>
        ))}
      </div>

      {full ? (
        <div className="table-foot">
          <span>
            Showing {rows.length ? (current - 1) * pageSize + 1 : 0}–{(current - 1) * pageSize + rows.length} of {filtered.length}
          </span>
          <div className="pager">
            <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)} aria-label="Previous page">
              <Icon name="chevLeft" size={16} />
            </button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button key={p} type="button" className={p === current ? 'on' : ''} onClick={() => setPage(p)}>
                {p}
              </button>
            ))}
            <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)} aria-label="Next page">
              <Icon name="chevRight" size={16} />
            </button>
          </div>
        </div>
      ) : null}

      <div className={`bulk-bar ${full && live.length ? 'show' : ''}`} aria-hidden={!(full && live.length)}>
        <strong>{live.length} selected</strong>
        <button
          type="button"
          onClick={() => {
            updateActivity(live, { status: 'Completed' })
            toast('Updated', `${live.length} transactions marked as completed.`)
            setSelected([])
          }}
        >
          <Icon name="check" size={16} />
          Mark completed
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            removeActivities(live)
            toast('Removed', `${live.length} transactions deleted.`, { icon: 'trash' })
            setSelected([])
          }}
        >
          <Icon name="trash" size={16} />
          Delete
        </button>
        <button type="button" className="x" onClick={() => setSelected([])} aria-label="Clear selection">
          <Icon name="close" size={16} />
        </button>
      </div>
    </>
  )
}
