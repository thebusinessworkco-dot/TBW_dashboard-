import { logger } from '../utils/logger.js'

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`
    }
  })
}

export function errorHandler(err, req, res, next) {
  logger.error(err.message, {
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  })

  // SQLite constraint errors
  if (err.code && err.code.startsWith('SQLITE_CONSTRAINT')) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'A record with this identifier or unique value already exists.'
        }
      })
    }
    if (err.message.includes('FOREIGN KEY')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'FOREIGN_KEY_VIOLATION',
          message: 'Referenced entity does not exist.'
        }
      })
    }
  }

  const statusCode = err.status || err.statusCode || 500
  const message = statusCode === 500 && process.env.NODE_ENV === 'production'
    ? 'Internal Server Error'
    : err.message || 'Internal Server Error'

  res.status(statusCode).json({
    success: false,
    error: {
      code: err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR'),
      message,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    }
  })
}
