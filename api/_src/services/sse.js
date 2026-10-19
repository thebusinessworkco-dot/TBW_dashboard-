import { logger } from '../utils/logger.js'

class SafeRealtimeManager {
  broadcast(eventType, data) {
    logger.debug(`[Realtime event] ${eventType}`, { data })
  }

  sendToUser(userId, eventType, data) {
    logger.debug(`[Realtime user event] ${eventType} -> user ${userId}`, { data })
  }

  addClient(res, userId) {
    logger.debug(`[Realtime] Client connected: user ${userId}`)
  }
}

export const sseManager = new SafeRealtimeManager()
