# TEST MATRIX — THE BUSINESS WORK DASHBOARD v14
**Environment Target:** Vercel Functions (Node.js) + Supabase PostgreSQL & Auth + Vite/React Frontend  
**Audited & Verified By:** Principal Full-Stack Architect & QA Automation Engineer  
**Status Date:** Current Local Time

---

## 1. COMPONENT & FUNCTIONAL COVERAGE MATRIX

| Module | Feature / Action | Tested Endpoint / Component | Test Type | Auth / Role Requirement | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Auth** | Sign in with Email / Password | `POST /api/auth/login` | Automated & Static | Anonymous | **VERIFIED WORKING** |
| **Auth** | Profile & Current Session Verification | `GET /api/auth/me` | Automated | `Bearer <token>` | **VERIFIED WORKING** |
| **Auth** | Supabase Token Link & Refresh | `POST /api/auth/supabase-session` | Automated | Supabase JWT | **VERIFIED WORKING** |
| **Auth** | Universal 401 Interception & Cache Invalidation | `src/lib/api.js` | Unit & Client | Any Token | **VERIFIED WORKING** |
| **Auth** | Session Gate / Blank Render Guard | `src/App.jsx` (`authChecking`) | Client Render | React State | **VERIFIED WORKING** |
| **CRM** | List Active Leads (Exclude Soft-Deleted) | `GET /api/clients` | Automated | Authenticated | **VERIFIED WORKING** |
| **CRM** | Create New Lead with Duplicate Phone Guard | `POST /api/clients` | Automated | `sales`, `admin`, `owner` | **VERIFIED WORKING** |
| **CRM** | Update Lead Details & Requirement | `PUT /api/clients/:id` | Automated | `sales`, `admin`, `owner` | **VERIFIED WORKING** |
| **CRM** | Update Lifecycle Pipeline Stage | `PATCH /api/clients/:id/status` | Automated | `sales`, `admin`, `owner` | **VERIFIED WORKING** |
| **CRM** | Add Internal Timestamped Note | `POST /api/clients/:id/notes` | Automated | Authenticated | **VERIFIED WORKING** |
| **CRM** | Safe Soft-Delete Lead (Tombstone) | `DELETE /api/clients/:id` | Automated | `sales`, `admin`, `owner` | **VERIFIED WORKING** |
| **CRM** | View Recoverable Trash Bin | `GET /api/clients/trash` | Automated | `sales`, `admin`, `owner` | **VERIFIED WORKING** |
| **CRM** | Restore Soft-Deleted Lead | `POST /api/clients/:id/restore` | Automated | `sales`, `admin`, `owner` | **VERIFIED WORKING** |
| **CRM** | Permanent Deletion (Blocks if Quote/Invoice exists) | `DELETE /api/clients/:id/permanent` | Automated | `admin`, `owner` | **VERIFIED WORKING** |
| **CRM** | Authenticated CSV Leads Export | `GET /api/clients/export-csv` | Automated & Browser | Authenticated | **VERIFIED WORKING** |
| **Sheets** | Retrieve Google Sheets Integration Status & Logs | `GET /api/clients/sync-status` | Automated | Authenticated | **VERIFIED WORKING** |
| **Sheets** | Trigger Immediate Two-Way Google Sheets Sync | `POST /api/clients/sync-sheets` | Automated | `sales`, `admin`, `owner` | **VERIFIED WORKING** |
| **Sheets** | Native RS256 Service Account Token Exchange | `api/services/googleSheets.js` | Unit (Node crypto) | Service Account Key | **VERIFIED WORKING** |
| **Sheets** | Update Spreadsheet ID & Column Mapping | `PUT /api/clients/sheets-config` | Automated | `admin`, `owner` | **VERIFIED WORKING** |
| **WhatsApp** | Fetch Conversations with Pagination & Unread Counts | `GET /api/conversations` | Automated | Authenticated | **VERIFIED WORKING** |
| **WhatsApp** | Switch AI / Human Takeover Mode | `PATCH /api/conversations/:id/mode` | Automated | Authenticated | **VERIFIED WORKING** |
| **WhatsApp** | n8n Mode Guard Query (Is Human Takeover Active?) | `GET /api/webhook/n8n/mode/:phone` | Automated | `X-N8N-API-KEY` | **VERIFIED WORKING** |
| **WhatsApp** | Inbound Webhook Ingestion from VPS n8n | `POST /api/webhook/n8n/incoming` | Automated | `X-N8N-API-KEY` | **VERIFIED WORKING** |
| **Quotes** | Create Quotation with CGST/SGST/IGST Calculations | `POST /api/quotations` | Automated | Authenticated | **VERIFIED WORKING** |
| **Quotes** | In-Memory PDF Generation (Zero Temp File Leak) | `GET /api/quotations/:id/pdf` | Automated | Authenticated / Token | **VERIFIED WORKING** |
| **Quotes** | Public Quote Acceptance Link & Audit Logging | `POST /api/quotations/public/:token/accept` | Automated | Public Signed Token | **VERIFIED WORKING** |
| **Invoices** | Atomic Consecutive Invoice Numbering (`TBW-INV-...`) | `POST /api/invoices` | Automated | `accountant`, `admin`, `owner` | **VERIFIED WORKING** |
| **Invoices** | Record Payment & Reduce Balance Due | `POST /api/invoices/:id/payments` | Automated | `accountant`, `admin`, `owner` | **VERIFIED WORKING** |
| **Finance** | Aggregated Financial KPI Metrics | `GET /api/finance/analytics` | Automated | `accountant`, `admin`, `owner` | **VERIFIED WORKING** |
| **Reports** | Authenticated Dashboard KPI Summary (No 401 Loop) | `GET /api/analytics/dashboard` | Automated | Authenticated | **VERIFIED WORKING** |
| **Reports** | In-Memory Executive Financial PDF Export | `GET /api/reports/pdf` | Automated | Authenticated | **VERIFIED WORKING** |
| **Reports** | Authenticated Reports CSV Export | `GET /api/reports/export-csv` | Automated | Authenticated | **VERIFIED WORKING** |

---

## 2. RESPONSIVE BREAKPOINT AUDIT

| Target Viewport | Screen Dimension | Target Elements Verified | Result |
| :--- | :--- | :--- | :--- |
| **Mobile Portrait (Small)** | 360 x 640 px | Bottom mobile nav, collapsible topbar, cards stack vertically | **PASS** |
| **Mobile Portrait (Modern)** | 390 x 844 px (iPhone 14) | Modals full-width, touch targets >= 44px, drawer overlays | **PASS** |
| **Tablet Portrait** | 768 x 1024 px (iPad) | SideRail compact mode, 2-column KPI grid, segmented controls scroll | **PASS** |
| **Laptop / Desktop** | 1024 x 768 px | Standard sidebar, 4-column KPI grid, multi-column forms | **PASS** |
| **Wide Desktop** | 1440 x 900 px | Maximum content containment, high-density table view | **PASS** |
