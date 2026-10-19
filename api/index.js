import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'

import { logger } from './_src/utils/logger.js'
import { apiLimiter } from './_src/middleware/rateLimit.js'
import { errorHandler, notFoundHandler } from './_src/middleware/errorHandler.js'

import healthRouter from './_src/routes/health.js'
import authRouter from './_src/routes/auth.js'
import teamRouter from './_src/routes/team.js'
import settingsRouter from './_src/routes/settings.js'
import auditRouter from './_src/routes/audit.js'
import conversationsRouter from './_src/routes/conversations.js'
import messagesRouter from './_src/routes/messages.js'
import webhookRouter from './_src/routes/webhook.js'
import sseRouter from './_src/routes/sse.js'
import quickRepliesRouter from './_src/routes/quickReplies.js'
import clientsRouter from './_src/routes/clients.js'
import quotationsRouter from './_src/routes/quotations.js'
import invoicesRouter from './_src/routes/invoices.js'
import paymentsRouter from './_src/routes/payments.js'
import subscriptionsRouter from './_src/routes/subscriptions.js'
import expensesRouter from './_src/routes/expenses.js'
import financeRouter from './_src/routes/finance.js'
import projectsRouter from './_src/routes/projects.js'
import appointmentsRouter from './_src/routes/appointments.js'
import servicesRouter from './_src/routes/services.js'
import notificationsRouter from './_src/routes/notifications.js'
import automationRouter from './_src/routes/automation.js'
import analyticsRouter from './_src/routes/analytics.js'
import reportsRouter from './_src/routes/reports.js'

dotenv.config()

const app = express()

// 1. Security & Parsing Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://dashboard.thebusinesswork.com',
  'https://thebusinesswork.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000'
].filter(Boolean)

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app') || origin.endsWith('.thebusinesswork.com')) {
      return callback(null, true)
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-N8N-API-KEY', 'apikey']
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
app.use(apiLimiter)

// 2. Mount API Routes on a shared router to support both /api/... and direct /... serverless routing
const apiRouter = express.Router()

apiRouter.use('/health', healthRouter)
apiRouter.use('/auth', authRouter)
apiRouter.use('/team', teamRouter)
apiRouter.use('/settings', settingsRouter)
apiRouter.use('/audit-log', auditRouter)
apiRouter.use('/conversations/:id/messages', messagesRouter)
apiRouter.use('/conversations', conversationsRouter)
apiRouter.use('/webhook/n8n', webhookRouter)
apiRouter.use('/sse', sseRouter)
apiRouter.use('/quick-replies', quickRepliesRouter)
apiRouter.use('/clients', clientsRouter)
apiRouter.use('/quotations', quotationsRouter)
apiRouter.use('/invoices', invoicesRouter)
apiRouter.use('/payments', paymentsRouter)
apiRouter.use('/subscriptions', subscriptionsRouter)
apiRouter.use('/expenses', expensesRouter)
apiRouter.use('/finance', financeRouter)
apiRouter.use('/projects', projectsRouter)
apiRouter.use('/appointments', appointmentsRouter)
apiRouter.use('/services', servicesRouter)
apiRouter.use('/notifications', notificationsRouter)
apiRouter.use('/automation', automationRouter)
apiRouter.use('/analytics', analyticsRouter)
apiRouter.use('/reports', reportsRouter)

// Mount on both /api and / to handle Vercel rewrites gracefully
app.use('/api', apiRouter)
app.use('/', apiRouter)

// 3. Fallback & Error Handling
app.use(notFoundHandler)
app.use(errorHandler)

export { app }
export default app
