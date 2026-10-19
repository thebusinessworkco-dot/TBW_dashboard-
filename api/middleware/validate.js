import { ZodError } from 'zod'

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
        const issues = err.issues || err.errors || []
        const details = issues.map(e => ({
          field: Array.isArray(e.path) ? e.path.join('.') : String(e.path || ''),
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
