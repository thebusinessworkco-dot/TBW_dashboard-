import { stamp } from './format'

export const toCsv = (rows) => {
  const head = 'Order ID,Activity,Price,Status,Date'
  const body = rows.map((r) => [r.id, `"${r.title}"`, r.price, r.status, `"${stamp(r.date)}"`].join(','))
  return [head, ...body].join('\n')
}

/** Hand the browser a file to save. */
export const saveFile = (name, text, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 500)
}
