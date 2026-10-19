import { requireOwner } from '../_lib/auth.js'
import { json, method, internalError } from '../_lib/http.js'

export default async function handler(req, res) {
  if (!method(req, res, 'GET')) return
  try {
    const result = await requireOwner(req)
    if (result.error) {
      return json(res, result.status, {
        success: false,
        error: { code: result.error, message: 'Not authorized.' },
      })
    }
    const { id, email, name, phone, role, avatar_url } = result.user
    return json(res, 200, { success: true, data: { user: { id, email, name, phone, role, avatar_url } } })
  } catch (error) {
    internalError(error, res)
  }
}
