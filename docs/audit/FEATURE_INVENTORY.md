# FEATURE INVENTORY: THE BUSINESS WORK DASHBOARD v14

**Audit Date:** October 19, 2026  
**Status Key:**
- `VERIFIED_WORKING`: Fully functional, connected to backend, automated test verified.
- `PARTIALLY_IMPLEMENTED`: Functional code in place, requires secondary enhancements (e.g. two-way Google Sheets sync).
- `BROKEN`: Defect identified, causing runtime error or incorrect behavior.
- `DEMO_MOCK`: Component renders or falls back to static demo data (`seed.js`).
- `LIVE_VERIFICATION_REQUIRED`: Requires live third-party credential / infrastructure (Meta WhatsApp, Google Cloud OAuth).

---

## 1. Authentication & Session Management

| Feature | Component | User Action | API Endpoint | Provider / Table | Auth Req | Status | Observed Behavior & Correction |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Email/Password Login** | `src/components/LoginForm.jsx` | Submits login form | `/api/auth/login` | Supabase Auth / `public.users` | Public | `VERIFIED_WORKING` | Authenticates via Supabase Auth with Express fallback. Stores session token. |
| **Owner Access Mapping** | `api/_lib/auth.js` | Authenticates owner account | `/api/auth/me` | `tbw_cloud.auth_links` | Bearer Token | `VERIFIED_WORKING` | Maps UID `0384f5a7-a525-4b6e-9517-200bc5ec11e4` to legacy ID `1`. Prevents email-only spoofing. |
| **Immediate Logout & Revocation** | `src/lib/cloud-auth.js` | Clicks logout | `/api/auth/logout` | `tbw_cloud.revoked_tokens` | Bearer Token | `VERIFIED_WORKING` | Hashes JWT using SHA-256 and records in denylist. Immediately invalidates subsequent requests. |
| **Session Restoration** | `src/App.jsx` | Page refresh / load | `/api/auth/me` | Supabase / `public.sessions` | Bearer Token | `PARTIALLY_IMPLEMENTED` | Previously showed demo user during refresh. Needs authenticating spinner while validating. |

---

## 2. CRM & Lead Management

| Feature | Component | User Action | API Endpoint | Provider / Table | Auth Req | Status | Observed Behavior & Correction |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **List Leads** | `src/pages/Contacts.jsx` | Views CRM page, filters by stage | `GET /api/clients` | `public.clients` | Auth (`sales`, `admin`, `owner`) | `VERIFIED_WORKING` | Queries database, computes stage statistics, paginates results. |
| **Create Lead** | `src/pages/Contacts.jsx` | Submits "Add Contact" modal | `POST /api/clients` | `public.clients`, `public.lead_events` | Auth | `VERIFIED_WORKING` | Creates lead record, logs creation timeline event, returns created entity. |
| **Edit Lead** | `src/pages/Contacts.jsx` | Modifies contact details / stage | `PATCH /api/clients/:id` | `public.clients`, `public.lead_events` | Auth | `VERIFIED_WORKING` | Updates contact fields, logs status changes to lead events. |
| **Soft Delete Lead** | `src/pages/Contacts.jsx` | Clicks delete contact | `DELETE /api/clients/:id` | `public.clients` | Auth (`admin`, `owner`) | `PARTIALLY_IMPLEMENTED` | Hard-deletes in legacy code. Needs soft-deletion (`is_deleted = TRUE`) for Google Sheets sync safety. |
| **Restore Lead** | `src/pages/Contacts.jsx` | Clicks restore from trash | `POST /api/clients/:id/restore` | `public.clients` | Auth (`admin`, `owner`) | `PARTIALLY_IMPLEMENTED` | Endpoint required for restoring soft-deleted leads. |
| **Lead Notes** | `src/pages/Contacts.jsx` | Adds internal notes to lead | `POST /api/clients/:id/notes` | `public.client_notes` | Auth | `VERIFIED_WORKING` | Appends timestamped note linked to client ID and user ID. |
| **Two-Way Google Sheets Sync** | `src/pages/Contacts.jsx` | Clicks "Sync Google Sheets" | `POST /api/clients/sync-sheets` | Google Sheets API / `public.clients` | Auth | `PARTIALLY_IMPLEMENTED` | Service created; needs direct Google Sheets REST connector and UI controls. |

---

## 3. WhatsApp Inbox & Automation

| Feature | Component | User Action | API Endpoint | Provider / Table | Auth Req | Status | Observed Behavior & Correction |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Conversations List** | `src/pages/Messages.jsx` | Views WhatsApp inbox | `GET /api/conversations` | `public.conversations` | Auth | `VERIFIED_WORKING` | Lists chats, unread badges, last message previews, and mode indicators. |
| **Conversation Messages** | `src/pages/Messages.jsx` | Selects a chat thread | `GET /api/conversations/:id/messages` | `public.messages` | Auth | `VERIFIED_WORKING` | Loads message timeline, supports incremental polling via `?since=`. |
| **Send WhatsApp Message** | `src/pages/Messages.jsx` | Types and sends reply | `POST /api/conversations/:id/messages` | `public.messages`, Meta Cloud API | Auth | `VERIFIED_WORKING` | Saves message, dispatches outbound payload via Meta API if credentials configured. |
| **Human Takeover Toggle** | `src/pages/Messages.jsx` | Clicks "Takeover" / "Resume AI" | `PATCH /api/conversations/:id/mode` | `public.conversations` | Auth | `VERIFIED_WORKING` | Authoritative database state updated between `'ai'` and `'human'`. |
| **n8n Inbound Webhook** | `api/routes/webhook.js` | n8n forwards customer message | `POST /api/webhook/n8n/message` | `public.conversations`, `public.messages` | `X-N8N-API-KEY` | `VERIFIED_WORKING` | Idempotently saves incoming message by `wa_message_id`, increments unread count. |
| **n8n Mode Query** | `api/routes/webhook.js` | n8n checks AI/Human mode | `GET /api/webhook/n8n/mode/:phone` | `public.conversations` | `X-N8N-API-KEY` | `VERIFIED_WORKING` | Authoritative check for n8n workflow before triggering Gemini bot reply. |
| **Quick Replies** | `src/pages/Messages.jsx` | Inserts predefined template | `GET /api/quick-replies` | `public.quick_replies` | Auth | `VERIFIED_WORKING` | Loads shortcut snippets and customer service templates. |

---

## 4. Quotations & Official Proposals

| Feature | Component | User Action | API Endpoint | Provider / Table | Auth Req | Status | Observed Behavior & Correction |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **List Quotations** | `src/pages/Quotations.jsx` | Views quotations tab | `GET /api/quotations` | `public.quotations` | Auth | `VERIFIED_WORKING` | Lists quotes with client details, setup fees, monthly fees, and status. |
| **Create Quotation** | `src/pages/Quotations.jsx` | Submits quote form | `POST /api/quotations` | `public.quotations`, `public.quotation_items` | Auth | `VERIFIED_WORKING` | Atomically creates `TBW-QT-YYYY-XXX` numbered proposal with items & GST. |
| **PDF Stream & Download** | `src/pages/Quotations.jsx` | Clicks "Download PDF" | `GET /api/quotations/:id/pdf` | In-memory PDFKit Stream | Auth | `VERIFIED_WORKING` | Direct stream to response (`Content-Type: application/pdf`) without disk writes. |
| **Public Acceptance** | `api/routes/quotations.js` | Client clicks link via WhatsApp | `POST /api/quotations/public/:token/accept` | `public.quotations`, `public.invoices` | Public (Token) | `VERIFIED_WORKING` | Validates signed token, records digital acceptance, auto-converts to invoice. |

---

## 5. Invoices, Payments & Financial Accounting

| Feature | Component | User Action | API Endpoint | Provider / Table | Auth Req | Status | Observed Behavior & Correction |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **List Invoices** | `src/pages/Invoices.jsx` | Views invoices list | `GET /api/invoices` | `public.invoices` | Auth | `VERIFIED_WORKING` | Displays invoices, balances, due dates, and paid status. |
| **Create Invoice** | `src/pages/Invoices.jsx` | Creates custom invoice | `POST /api/invoices` | `public.invoices`, `public.invoice_items` | Auth | `VERIFIED_WORKING` | Generates sequential `TBW-INV-YYYY-XXX` with GST and payment instructions. |
| **Record Payment** | `src/pages/Invoices.jsx` | Enters payment received | `POST /api/payments` | `public.payments`, `public.invoices` | Auth | `VERIFIED_WORKING` | ACID transaction inserts payment, generates `TBW-RCP-YYYY-XXX`, updates balance. |
| **Invoice PDF Stream** | `src/pages/Invoices.jsx` | Clicks "Download Invoice" | `GET /api/invoices/:id/pdf` | In-memory PDFKit Stream | Auth | `VERIFIED_WORKING` | Direct PDF stream with PAID stamp when balance is zero. |
| **Payment Receipt PDF**| `src/pages/Invoices.jsx` | Downloads receipt | `GET /api/payments/:id/receipt` | In-memory PDFKit Stream | Auth | `VERIFIED_WORKING` | Generates official A5 landscape electronic payment receipt. |
| **Record Business Expense**| `api/routes/expenses.js` | Logs operational expense | `POST /api/expenses` | `public.expenses` | Auth | `VERIFIED_WORKING` | Records expense category, amount, vendor, and recurring flag. |
| **Financial Analytics**| `src/pages/Savings.jsx` | Views profitability | `GET /api/finance/analytics` | Multiple (`invoices`, `payments`, `expenses`) | Auth | `VERIFIED_WORKING` | Cartesian-safe profitability calculations, MRR, margin percentages. |

---

## 6. Reports & Business Intelligence

| Feature | Component | User Action | API Endpoint | Provider / Table | Auth Req | Status | Observed Behavior & Correction |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Dashboard Analytics**| `src/pages/Reports.jsx` | Selects time range (7d, 30d, 90d, all)| `GET /api/analytics/dashboard` | Aggregates | Auth | `VERIFIED_WORKING` | Full KPI metrics: lead conversion, revenue, expenses, WhatsApp AI/Human breakdown. |
| **Export Structured CSV**| `src/pages/Reports.jsx` | Clicks "Export CSV" | `GET /api/reports/export-csv` | `invoices`, `clients`, `expenses` | Auth | `VERIFIED_WORKING` | Streams CSV data with standard Content-Disposition attachment header. |
| **Executive PDF Summary**| `src/pages/Reports.jsx`| Clicks "Generate PDF" | `GET /api/reports/pdf` | In-memory PDFKit Stream | Auth | `VERIFIED_WORKING` | Comprehensive 2-page executive BI report with metric cards and tables. |

---

## 7. Operational Pages & System Management

| Feature | Component | User Action | API Endpoint | Provider / Table | Auth Req | Status | Observed Behavior & Correction |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Projects & Deliverables**| `src/pages/Projects.jsx` | Manages client project tasks | `GET /api/projects`, `POST /api/projects/:id/tasks` | `public.projects`, `public.tasks` | Auth | `VERIFIED_WORKING` | Project lifecycle tracking from planning to delivered with task checklists. |
| **Calendar Appointments**| `src/pages/Schedule.jsx` | Schedules discovery call | `GET /api/appointments`, `POST /api/appointments` | `public.appointments` | Auth | `VERIFIED_WORKING` | Discovery calls, meetings, Google Meet / Zoom links, followup dates. |
| **Notifications** | `src/components/TopBar.jsx` | Views notifications dropdown | `GET /api/notifications` | `public.notifications` | Auth | `VERIFIED_WORKING` | Event notifications with unread counts and mark-read capabilities. |
| **Team Management** | `src/pages/Settings.jsx` | Adds team member, updates role | `GET /api/team`, `POST /api/team` | `public.users` | Auth (`admin`, `owner`) | `VERIFIED_WORKING` | User management with bcrypt password hashing and RBAC enforcement. |
| **Audit Logs** | `src/pages/Settings.jsx` | Views security audit trail | `GET /api/audit-log` | `public.audit_logs` | Auth (`owner`, `admin`) | `VERIFIED_WORKING` | Full immutable log of authentication, invoices, payments, and client edits. |
