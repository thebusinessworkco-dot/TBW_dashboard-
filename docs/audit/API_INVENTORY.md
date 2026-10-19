# API INVENTORY: THE BUSINESS WORK DASHBOARD v14

**Audit Date:** October 19, 2026  
**Runtime:** Vercel Node.js Serverless Functions (`@vercel/node` / Express unified entrypoint)  
**Database Client:** `pg.Pool` (Max: 1 per warm instance, SSL Transaction Pooler on Port 6543)

---

## 1. Overview of Mounted API Routes

All routes are mounted via Express router at `/api/*` and mirrored to `/*` to ensure full compatibility with Vercel SPA rewrites:

```
[Vercel Function Handler: api/index.js]
  ├── /health                       -> api/routes/health.js
  ├── /auth                         -> api/routes/auth.js
  ├── /team                         -> api/routes/team.js
  ├── /settings                     -> api/routes/settings.js
  ├── /audit-log                    -> api/routes/audit.js
  ├── /conversations/:id/messages   -> api/routes/messages.js
  ├── /conversations                -> api/routes/conversations.js
  ├── /webhook/n8n                  -> api/routes/webhook.js
  ├── /sse                          -> api/routes/sse.js
  ├── /quick-replies                -> api/routes/quickReplies.js
  ├── /clients                      -> api/routes/clients.js
  ├── /quotations                   -> api/routes/quotations.js
  ├── /invoices                     -> api/routes/invoices.js
  ├── /payments                     -> api/routes/payments.js
  ├── /subscriptions                -> api/routes/subscriptions.js
  ├── /expenses                     -> api/routes/expenses.js
  ├── /finance                      -> api/routes/finance.js
  ├── /projects                     -> api/routes/projects.js
  ├── /appointments                 -> api/routes/appointments.js
  ├── /services                     -> api/routes/services.js
  ├── /notifications                -> api/routes/notifications.js
  ├── /automation                   -> api/routes/automation.js
  ├── /analytics                    -> api/routes/analytics.js
  └── /reports                      -> api/routes/reports.js
```

---

## 2. Granular Route Specifications

### 1. System & Health
* `GET /api/health` — Public. Returns system health, PostgreSQL roundtrip latency, runtime metadata (`vercel-serverless-nodejs`), and timestamp. Status 200 or 503.

### 2. Authentication (`/api/auth`)
* `POST /api/auth/login` — Public, rate-limited. Zod validated: `{ email, password }`. Generates session token, sets HttpOnly cookie, returns `{ success: true, data: { user, token } }`.
* `POST /api/auth/logout` — Requires Auth. Invalidates token in `tbw_cloud.revoked_tokens` and removes active session.
* `GET /api/auth/me` — Requires Auth. Resolves Supabase JWT or session token. Returns current authenticated user and linked owner UID.
* `POST /api/auth/refresh` — Requires Auth. Renews active session.

### 3. Team Management (`/api/team`)
* `GET /api/team` — Requires Role (`admin`, `owner`). Returns team members list without password hashes.
* `POST /api/team` — Requires Role (`admin`, `owner`). Validated: `{ email, password, name, role }`. Inserts new user with bcrypt hash.
* `PATCH /api/team/:id` — Requires Role (`admin`, `owner`). Updates name, role, phone, or active status.
* `PATCH /api/team/:id/password` — Requires Role (`admin`, `owner`). Updates user password.
* `DELETE /api/team/:id` — Requires Role (`admin`, `owner`). Deactivates team member.

### 4. Settings (`/api/settings`)
* `GET /api/settings` — Requires Auth. Returns application key-value configuration.
* `PUT /api/settings` — Requires Role (`admin`, `owner`). Updates system configuration keys.

### 5. Audit Log (`/api/audit-log`)
* `GET /api/audit-log` — Requires Role (`admin`, `owner`). Paginated audit history with user and action filters.

### 6. WhatsApp Inbox (`/api/conversations`)
* `GET /api/conversations` — Requires Auth. Lists active WhatsApp conversations with unread badges, modes, and last message previews.
* `GET /api/conversations/:id` — Requires Auth. Conversation detail and metadata.
* `PATCH /api/conversations/:id/mode` — Requires Auth. Toggles `mode` between `'ai'` and `'human'`. Authoritative state for Gemini bot bypass.
* `PATCH /api/conversations/:id/status` — Requires Auth. Updates status (`'open'`, `'closed'`, `'archived'`).
* `PATCH /api/conversations/:id/assign` — Requires Auth. Assigns conversation to team member.
* `POST /api/conversations/:id/notes` — Requires Auth. Appends internal conversation note.

### 7. WhatsApp Messages (`/api/conversations/:id/messages`)
* `GET /api/conversations/:id/messages` — Requires Auth. Fetches message thread. Supports incremental polling via `?since=ISO_TIMESTAMP`.
* `POST /api/conversations/:id/messages` — Requires Auth. Sends manual outbound message, dispatches Meta Cloud API if configured.

### 8. Webhook Integrations (`/api/webhook/n8n`)
* `GET /api/webhook/n8n/mode/:phone` — Requires `X-N8N-API-KEY`. Returns mode (`'ai'` or `'human'`) for n8n routing logic.
* `POST /api/webhook/n8n/message` (and `/incoming` alias) — Requires `X-N8N-API-KEY`. Ingests customer message with `wa_message_id` deduplication.
* `POST /api/webhook/n8n/status` — Requires `X-N8N-API-KEY`. Updates delivery status (`sent`, `delivered`, `read`, `failed`).

### 9. Quick Replies (`/api/quick-replies`)
* `GET /api/quick-replies` — Requires Auth. Returns message response templates.
* `POST /api/quick-replies` — Requires Role (`sales`, `admin`, `owner`). Creates template.
* `PUT /api/quick-replies/:id` — Requires Role (`sales`, `admin`, `owner`). Updates template.
* `DELETE /api/quick-replies/:id` — Requires Role (`sales`, `admin`, `owner`). Deletes template.

### 10. CRM & Clients (`/api/clients`)
* `GET /api/clients` — Requires Auth. Paginated lead list with stage filters, search, and metrics.
* `GET /api/clients/:id` — Requires Auth. Full client profile, timeline events, and linked quotations/invoices.
* `POST /api/clients` — Requires Auth. Validated: `{ name, phone, email, business_name, lifecycle_status, budget }`.
* `PATCH /api/clients/:id` — Requires Auth. Updates client details and logs stage transitions.
* `DELETE /api/clients/:id` — Requires Role (`admin`, `owner`). Soft-deletes client for safe Google Sheets sync.
* `POST /api/clients/:id/restore` — Requires Role (`admin`, `owner`). Restores soft-deleted lead.
* `GET /api/clients/trash` — Requires Role (`admin`, `owner`). Lists soft-deleted leads.
* `POST /api/clients/sync-sheets` — Requires Role (`admin`, `owner`). Triggers immediate two-way Google Sheets synchronization.
* `GET /api/clients/sync-status` — Requires Auth. Returns last Google Sheets sync timestamp and status.

### 11. Quotations (`/api/quotations`)
* `GET /api/quotations` — Requires Auth. Lists quotations with total setup and monthly maintenance fees.
* `GET /api/quotations/:id` — Requires Auth. Detailed quotation with line items and terms.
* `POST /api/quotations` — Requires Auth. Generates `TBW-QT-YYYY-XXX` with GST tax breakdown.
* `GET /api/quotations/:id/pdf` — Requires Auth. Streams generated PDF directly to response.
* `POST /api/quotations/public/:token/accept` — Public. Digital sign-off, auto-converts to invoice.

### 12. Invoices (`/api/invoices`)
* `GET /api/invoices` — Requires Auth. Lists invoices, balances, due dates.
* `GET /api/invoices/:id` — Requires Auth. Single invoice detail and line items.
* `POST /api/invoices` — Requires Role (`accountant`, `admin`, `owner`). Generates `TBW-INV-YYYY-XXX`.
* `GET /api/invoices/:id/pdf` — Requires Auth. Streams official PDF with PAID stamp if settled.

### 13. Payments (`/api/payments`)
* `GET /api/payments` — Requires Auth. Lists payments and receipts.
* `POST /api/payments` — Requires Role (`accountant`, `admin`, `owner`). Records payment, generates `TBW-RCP-YYYY-XXX`, updates invoice balance in ACID transaction.
* `GET /api/payments/:id/receipt` — Requires Auth. Streams official payment receipt PDF.

### 14. Subscriptions (`/api/subscriptions`)
* `GET /api/subscriptions` — Requires Auth. Calculates active MRR and lists recurring subscriptions.
* `POST /api/subscriptions` — Requires Role (`accountant`, `admin`, `owner`). Creates subscription.
* `PATCH /api/subscriptions/:id/status` — Requires Role (`accountant`, `admin`, `owner`). Updates status (`active`, `paused`, `cancelled`).
* `POST /api/subscriptions/:id/renew` — Requires Role (`accountant`, `admin`, `owner`). Advances billing date by 1 month/cycle.

### 15. Expenses (`/api/expenses`)
* `GET /api/expenses` — Requires Role (`accountant`, `admin`, `owner`). Lists expenses with date and category filters.
* `POST /api/expenses` — Requires Role (`accountant`, `admin`, `owner`). Logs business expense.
* `DELETE /api/expenses/:id` — Requires Role (`admin`, `owner`). Deletes expense record.

### 16. Financial Intelligence (`/api/finance`)
* `GET /api/finance/analytics` — Requires Role (`accountant`, `admin`, `owner`). Cartesian-safe client profitability, collected vs invoiced revenue, expense breakdown, and profit margins.

### 17. Projects & Tasks (`/api/projects`)
* `GET /api/projects` — Requires Auth. Lists projects with total and completed task counts.
* `GET /api/projects/:id` — Requires Auth. Project detail with task checklist.
* `POST /api/projects` — Requires Role (`sales`, `admin`, `owner`). Creates project.
* `PATCH /api/projects/:id/status` — Requires Auth. Updates status.
* `GET /api/projects/:id/tasks` — Requires Auth. Lists tasks.
* `POST /api/projects/:id/tasks` — Requires Auth. Adds task.
* `PATCH /api/projects/tasks/:taskId` — Requires Auth. Updates task status or priority.
* `DELETE /api/projects/tasks/:taskId` — Requires Auth. Deletes task.

### 18. Appointments (`/api/appointments`)
* `GET /api/appointments` — Requires Auth. Calendar events and discovery calls.
* `POST /api/appointments` — Requires Auth. Schedules appointment, creates lead event.
* `PATCH /api/appointments/:id/status` — Requires Auth. Updates appointment status.
* `DELETE /api/appointments/:id` — Requires Auth. Removes appointment.

### 19. Services Catalog (`/api/services`)
* `GET /api/services` — Public. Returns active services grouped by category.
* `GET /api/services/packages` — Public. Returns service packages.
* `POST /api/services/packages` — Requires Role (`admin`, `owner`). Creates or updates package.

### 20. Notifications (`/api/notifications`)
* `GET /api/notifications` — Requires Auth. Returns user notifications and unread count.
* `PATCH /api/notifications/:id/read` — Requires Auth. Marks notification as read.
* `PATCH /api/notifications/read-all` — Requires Auth. Marks all notifications as read.
* `POST /api/notifications` — Requires Auth. Dispatches notification.

### 21. Automation Monitoring (`/api/automation`)
* `GET /api/automation/status` — Requires Role (`admin`, `owner`). n8n engine health, active workflows, and error logs.
* `POST /api/automation/log` — Requires `X-N8N-API-KEY`. Logs workflow execution status from n8n.

### 22. Analytics Dashboard (`/api/analytics`)
* `GET /api/analytics/dashboard` — Requires Auth. Comprehensive KPI data for date ranges (`today`, `7d`, `30d`, `90d`, `all`).

### 23. Reports (`/api/reports`)
* `GET /api/reports/export-csv` — Requires Auth. Generates and streams structured CSV files (`invoices`, `clients`, `expenses`, `profitability`, `payments`).
* `GET /api/reports/pdf` — Requires Auth. Generates and streams executive BI report PDF.

### 24. Serverless Realtime (`/api/sse`)
* `GET /api/sse/events` — Requires Auth. Authenticates token, sends serverless status notice, and closes gracefully.
