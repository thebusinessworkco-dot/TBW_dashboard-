import { logger } from '../utils/logger.js'

export async function sendMetaTextMessage({ to, text }) {
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID
  const accessToken = process.env.WA_ACCESS_TOKEN

  if (!phoneNumberId || !accessToken) {
    logger.debug('Meta WhatsApp credentials not configured; skipping direct Meta API call')
    return {
      success: false,
      skipped: true,
      reason: 'MISSING_CREDENTIALS'
    }
  }

  const cleanPhone = to.replace(/[^0-9]/g, '')
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanPhone,
    type: 'text',
    text: { preview_url: false, body: text }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload)
    })

    const data = await res.json()

    if (!res.ok) {
      logger.error('Meta Cloud API error', { status: res.status, error: data })
      return {
        success: false,
        error: data.error?.message || 'Meta API returned error',
        raw: data
      }
    }

    const waMsgId = data.messages?.[0]?.id
    return {
      success: true,
      wa_message_id: waMsgId,
      raw: data
    }
  } catch (err) {
    logger.error('Meta Cloud API network failure', { error: err.message })
    return {
      success: false,
      error: err.message
    }
  }
}
