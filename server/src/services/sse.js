import { logger } from '../utils/logger.js'

class SSEManager {
  constructor() {
    this.clients = new Set()
  }

  addClient(res, userId) {
    const client = { res, userId, id: Math.random().toString(36).substring(7) }
    this.clients.add(client)

    logger.debug(`SSE client connected: ${client.id} (user ${userId}). Total clients: ${this.clients.size}`)

    // Keep connection alive with periodic comment ping every 25 seconds
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        clearInterval(pingInterval)
        this.removeClient(client)
      }
    }, 25000)

    res.on('close', () => {
      clearInterval(pingInterval)
      this.removeClient(client)
    })

    return client
  }

  removeClient(client) {
    this.clients.delete(client)
    logger.debug(`SSE client disconnected: ${client.id}. Total clients: ${this.clients.size}`)
  }

  broadcast(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of this.clients) {
      try {
        client.res.write(payload)
      } catch (err) {
        logger.error('Failed to write SSE event to client', { clientId: client.id, error: err.message })
        this.removeClient(client)
      }
    }
  }

  sendToUser(userId, eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of this.clients) {
      if (client.userId === userId) {
        try {
          client.res.write(payload)
        } catch {
          this.removeClient(client)
        }
      }
    }
  }
}

export const sseManager = new SSEManager()
