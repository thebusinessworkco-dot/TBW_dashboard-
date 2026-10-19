import { getPool } from './_lib/db.js'
import { json, method, internalError } from './_lib/http.js'

export default async function handler(req, res) {
  if (!method(req, res, 'GET')) return
  try {
    await getPool().query('SELECT 1')
    return json(res, 200, { success: true, data: { status: 'ok' } })
  } catch (error) {
    internalError(error, res)
  }
}
