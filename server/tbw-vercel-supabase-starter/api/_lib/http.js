export function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.status(status).json(body)
}

export function method(req, res, allowed) {
  if (req.method === allowed) return true
  res.setHeader('Allow', allowed)
  json(res, 405, { success: false, error: { code: 'METHOD_NOT_ALLOWED' } })
  return false
}

export function internalError(error, res) {
  // No error.stack or database strings in response.
  console.error('API request failed:', error?.code || error?.name || 'UNEXPECTED_ERROR')
  json(res, 503, { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable.' } })
}
