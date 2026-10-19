import { logger } from '../utils/logger.js'

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl || req.url}`
    }
  })
}

export function errorHandler(err, req, res, next) {
  logger.error(err.message, {
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    url: req.originalUrl || req.url,
    method: req.method,
    ip: req.ip
  })

  // PostgreSQL constraint violations
  // 23505: unique_violation
  if (err.code === '23505' || (err.message && err.message.toLowerCase().includes('unique constraint'))) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'A record with this identifier or unique value already exists.'
      }
    })
  }

  // 23503: foreign_key_violation
  if (err.code === '23503' || (err.message && err.message.toLowerCase().includes('foreign key constraint'))) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'FOREIGN_KEY_VIOLATION',
        message: 'Referenced entity does not exist.'
      }
    })
  }

  // 23514: check_violation
  if (err.code === '23514' || (err.message && err.message.toLowerCase().includes('check constraint'))) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'CHECK_VIOLATION',
        message: 'A value violates database validation rules.'
      }
    })
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
