import crypto from 'crypto'

export function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex')
}

export function generateNumericCode(length = 6) {
  const min = Math.pow(10, length - 1)
  const max = Math.pow(10, length) - 1
  return crypto.randomInt(min, max + 1).toString()
}

/**
 * Creates an HMAC-signed, time-expiring URL-safe token.
 * Default expiration is 7 days (604,800 seconds).
 */
export function createSignedExpiringToken(payload, expiresInSeconds = 604800) {
  const secret = process.env.SESSION_SECRET || 'tbw-default-secret-key-change-in-prod'
  const expiresAt = Date.now() + expiresInSeconds * 1000
  const data = `${payload}:${expiresAt}`
  const signature = crypto.createHmac('sha256', secret).update(data).digest('hex')
  return Buffer.from(`${data}:${signature}`).toString('base64url')
}

/**
 * Verifies an HMAC-signed expiring token and ensures it has not passed expiresAt.
 */
export function verifySignedExpiringToken(tokenString, expectedPayload = null) {
  try {
    const secret = process.env.SESSION_SECRET || 'tbw-default-secret-key-change-in-prod'
    const decoded = Buffer.from(tokenString, 'base64url').toString('utf8')
    const parts = decoded.split(':')
    if (parts.length !== 3) return null
    const [payload, expiresAtStr, signature] = parts
    const expiresAt = parseInt(expiresAtStr, 10)
    if (isNaN(expiresAt) || Date.now() > expiresAt) return null

    const data = `${payload}:${expiresAt}`
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('hex')
    if (signature.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSig, 'hex'))) {
      if (expectedPayload !== null && payload !== String(expectedPayload)) return null
      return { payload, expiresAt }
    }
    return null
  } catch {
    return null
  }
}
