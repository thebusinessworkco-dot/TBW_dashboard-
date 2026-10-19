import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'

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
