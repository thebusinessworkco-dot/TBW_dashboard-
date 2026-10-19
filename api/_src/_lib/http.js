export function json(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export function error(res, status, code, message, details = null) {
  json(res, status, {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  })
}
