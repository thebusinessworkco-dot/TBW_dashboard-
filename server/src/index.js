import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'

import { runMigrations } from './db/migrate.js'
import { seedOwner } from './db/seed.js'
import { closeDb } from './db/connection.js'
import { logger } from './utils/logger.js'

import { apiLimiter } from './middleware/rateLimit.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'

import healthRouter from './routes/health.js'
import authRouter from './routes/auth.js'
import teamRouter from './routes/team.js'
import settingsRouter from './routes/settings.js'
import auditRouter from './routes/audit.js'
import conversationsRouter from './routes/conversations.js'
import messagesRouter from './routes/messages.js'
import webhookRouter from './routes/webhook.js'
import sseRouter from './routes/sse.js'
import quickRepliesRouter from './routes/quickReplies.js'
import clientsRouter from './routes/clients.js'
import quotationsRouter from './routes/quotations.js'
import invoicesRouter from './routes/invoices.js'
import paymentsRouter from './routes/payments.js'
import subscriptionsRouter from './routes/subscriptions.js'
import expensesRouter from './routes/expenses.js'
import financeRouter from './routes/finance.js'
import projectsRouter from './routes/projects.js'
import appointmentsRouter from './routes/appointments.js'
import servicesRouter from './routes/services.js'
import notificationsRouter from './routes/notifications.js'
import automationRouter from './routes/automation.js'
import analyticsRouter from './routes/analytics.js'
import reportsRouter from './routes/reports.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

// 1. Security & Parsing Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))

const allowedOrigins = [
  FRONTEND_URL,
  'https://dashboard.thebusinesswork.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000'
].filter(Boolean)

app.use(cors({
  origin(origin, callback) {
    // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-N8N-API-KEY']
}))

app.use(cookieParser())
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))

// Request logging (debug only)
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    logger.debug(`${req.method} ${req.url}`, { ip: req.ip })
  }
  next()
})

// Rate limit all API routes
app.use('/api', apiLimiter)

// 2. Mount API Routes
app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/team', teamRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/audit-log', auditRouter)
app.use('/api/conversations/:id/messages', messagesRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/webhook/n8n', webhookRouter)
app.use('/api/sse', sseRouter)
app.use('/api/quick-replies', quickRepliesRouter)
app.use('/api/clients', clientsRouter)
app.use('/api/quotations', quotationsRouter)
app.use('/api/invoices', invoicesRouter)
app.use('/api/payments', paymentsRouter)
app.use('/api/subscriptions', subscriptionsRouter)
app.use('/api/expenses', expensesRouter)
app.use('/api/finance', financeRouter)
app.use('/api/projects', projectsRouter)
app.use('/api/appointments', appointmentsRouter)
app.use('/api/services', servicesRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/automation', automationRouter)
app.use('/api/analytics', analyticsRouter)
app.use('/api/reports', reportsRouter)

// 3. Fallback & Error Handling
app.use(notFoundHandler)
app.use(errorHandler)

// 4. Server Lifecycle
let server = null

export async function startServer(port = PORT) {
  try {
    logger.info('Initializing database...')
    runMigrations()
    await seedOwner()

    return new Promise((resolve) => {
      server = app.listen(port, () => {
        logger.info(`TBW API server running on port ${port} [${process.env.NODE_ENV || 'development'}]`)
        resolve(server)
      })
    })
  } catch (err) {
    logger.error('Failed to start server', { error: err.message, stack: err.stack })
    process.exit(1)
  }
}

export function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        closeDb()
        logger.info('TBW API server stopped cleanly.')
        resolve()
      })
    } else {
      closeDb()
      resolve()
    }
  })
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...')
  await stopServer()
  process.exit(0)
})

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...')
  await stopServer()
  process.exit(0)
})

// Auto-start when executed directly
if (process.argv[1] && (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('src\\index.js'))) {
  startServer()
}

export default app
