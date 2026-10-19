import rateLimit from 'express-rate-limit'

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10) // 15 mins
const max = parseInt(process.env.RATE_LIMIT_MAX || '100', 10)
const loginMax = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10)

export const apiLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test' || req.path === '/health' || req.path.startsWith('/sse'),
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests from this IP, please try again after 15 minutes.'
    }
  }
})

export const loginLimiter = rateLimit({
  windowMs,
  max: loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Too many failed login attempts, please try again after 15 minutes.'
    }
  }
})
