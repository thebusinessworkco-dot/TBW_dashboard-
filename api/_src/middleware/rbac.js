/**
 * Role-Based Access Control middleware generator.
 * @param {...string} allowedRoles - Roles allowed to access the route ('owner', 'admin', 'sales', 'support', 'accountant', 'viewer')
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      })
    }

    // Owner always has full access to all roles' permissions
    if (req.user.role === 'owner') {
      return next()
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Requires one of: [${allowedRoles.join(', ')}]. Your role is '${req.user.role}'.`
        }
      })
    }

    next()
  }
}
