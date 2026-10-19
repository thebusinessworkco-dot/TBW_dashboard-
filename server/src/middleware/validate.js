import { ZodError } from 'zod'

/**
 * Creates an Express middleware to validate req.body, req.query, or req.params against Zod schemas.
 * @param {Object} schemas - { body?: ZodSchema, query?: ZodSchema, params?: ZodSchema }
 */
export function validate(schemas = {}) {
  return (req, res, next) => {
    try {
      if (schemas.body && req.body) {
        req.body = schemas.body.parse(req.body)
      }
      if (schemas.query && req.query) {
        req.query = schemas.query.parse(req.query)
      }
      if (schemas.params && req.params) {
        req.params = schemas.params.parse(req.params)
      }
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
          code: e.code
        }))
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details
          }
        })
      }
      next(err)
    }
  }
}
