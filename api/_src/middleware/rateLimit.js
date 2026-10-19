const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10)
const max = parseInt(process.env.RATE_LIMIT_MAX || '1000', 10)
const loginMax = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '10', 10)

// In-memory request counters per IP
const ipRequests = new Map()
const loginRequests = new Map()

export function apiLimiter(req, res, next) {
  if (req.path === '/health' || req.path.startsWith('/sse')) {
    return next()
  }

  const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1'
  const now = Date.now()
  const record = ipRequests.get(ip) || { count: 0, resetTime: now + windowMs }

  if (now > record.resetTime) {
    record.count = 0
    record.resetTime = now + windowMs
  }

  record.count += 1
  ipRequests.set(ip, record)

  res.setHeader('RateLimit-Limit', max)
  res.setHeader('RateLimit-Remaining', Math.max(0, max - record.count))
  res.setHeader('RateLimit-Reset', Math.ceil(record.resetTime / 1000))

  if (record.count > max) {
    return res.status(429).json({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests, please try again later.'
      }
    })
  }

  next()
}

export function loginLimiter(req, res, next) {
  if (process.env.NODE_ENV === 'test') {
    return next()
  }

  const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1'
  const now = Date.now()
  const record = loginRequests.get(ip) || { count: 0, resetTime: now + windowMs }

  if (now > record.resetTime) {
    record.count = 0
    record.resetTime = now + windowMs
  }

  record.count += 1
  loginRequests.set(ip, record)

  if (record.count > loginMax) {
    return res.status(429).json({
      success: false,
      error: {
        code: 'TOO_MANY_LOGIN_ATTEMPTS',
        message: 'Too many login attempts, please try again after 15 minutes.'
      }
    })
  }

  next()
}
