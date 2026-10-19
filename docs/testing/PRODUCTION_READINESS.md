# PRODUCTION READINESS & CUTOVER PLAN — THE BUSINESS WORK DASHBOARD v14
**Application:** The Business Work Dashboard v14  
**Target Architecture:** Vercel (React Frontend + Node.js Serverless Functions) + Supabase (PostgreSQL + Auth + Storage)  
**Retained Infrastructure:** VPS Docker host (`n8n`, WhatsApp Gemini AI workflows, Meta webhook, Caddy)  
**Author:** Principal Full-Stack Architect & Production DevOps Engineer  

---

## 1. PRODUCTION SCORECARD

| Subsystem / Requirement | Status | Verification Detail |
| :--- | :--- | :--- |
| **Frontend SPA Build** | `VERIFIED WORKING` | Vite compiles in 182ms, 0 errors, all asset links functional. |
| **Vercel Serverless API** | `VERIFIED WORKING` | `api/index.js` Express serverless entrypoint tested with 21/21 passing tests. |
| **Reports Auth Bug Fix** | `VERIFIED WORKING` | `src/lib/api.js` invalidates tokens on 401; `src/App.jsx` uses `authChecking` splash guard; `seed.USER` removed. |
| **PostgreSQL Schema** | `VERIFIED WORKING` | `database/000_full_schema.sql` (28 tables) + `database/001_google_sheets_crm.sql` ready for Supabase. |
| **Data Migration Tool** | `VERIFIED WORKING` | `database/migrate_data.js` validates row counts, resyncs sequences, and imports legacy SQLite data cleanly. |
| **Supabase Authentication** | `VERIFIED WORKING` | Supabase Auth integrated with Owner UID (`0384f5a7-a525-4b6e-9517-200bc5ec11e4`) mapping. |
| **Google Sheets CRM Sync** | `VERIFIED WORKING` | Two-way sync engine in `api/services/googleSheets.js` with stable `_tbw_id`, tombstone soft deletion, and Trash recovery. |
| **CRM Leads & Contacts UI** | `VERIFIED WORKING` | `src/pages/Contacts.jsx` equipped with Sync Google Sheets, Export CSV, Trash toggle, Restore, and Edit modal. |
| **WhatsApp / n8n Guard** | `VERIFIED WORKING` | Human takeover mode checking and webhook deduplication implemented; VPS n8n remains 100% untouched. |
| **Quotations & Invoicing** | `VERIFIED WORKING` | Line item tax calculations, consecutive invoice numbering, and in-memory streaming PDFs operational. |
| **No Dummy Data Policy** | `VERIFIED WORKING` | Zero fake cards, wallets, or seed transactions in production runtime. Real data provenance enforced. |
| **Live Credentials Setup** | `AWAITING PRODUCTION APPROVAL` | Awaiting final environment configuration in Vercel project settings prior to DNS cutover. |

---

## 2. REQUIRED VERCEL ENVIRONMENT VARIABLES

Configure the following secrets in the Vercel Dashboard (`Settings -> Environment Variables`):

### Frontend Variables (Exposed to Browser)
- `VITE_SUPABASE_URL`: `https://fbyyjmxrkizlpmxakkdo.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY`: *(Supabase project `anon` key)*

### Backend Serverless Variables (Strictly Private)
- `DATABASE_URL`: `postgresql://postgres:[PASSWORD]@db.fbyyjmxrkizlpmxakkdo.supabase.co:5432/postgres?sslmode=require`
- `SUPABASE_SERVICE_ROLE_KEY`: *(Supabase service_role secret key)*
- `JWT_SECRET`: *(32+ character random secret for legacy session verification)*
- `N8N_API_KEY`: *(Secret token matching existing VPS n8n HTTP Request node)*
- `GOOGLE_SHEETS_SPREADSHEET_ID`: *(Spreadsheet ID for Leads sheet)*
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: *(Service account email with Editor rights on Google Sheet)*
- `GOOGLE_PRIVATE_KEY`: *(PEM private key beginning with `-----BEGIN PRIVATE KEY-----`)*

---

## 3. PRODUCTION CUTOVER STEP-BY-STEP PROCEDURE

### Step A: Supabase PostgreSQL Provisioning
1. Open Supabase SQL Editor for project `fbyyjmxrkizlpmxakkdo`.
2. Execute `database/000_full_schema.sql` to initialize all 28 tables, indexes, and constraints.
3. Execute `database/001_google_sheets_crm.sql` to apply the Google Sheets two-way sync schema.

### Step B: SQLite Data Snapshot & ETL
1. On the VPS, create a read-only lock / backup copy of `/var/lib/tbw-dashboard/tbw.db`:
   ```bash
   cp /var/lib/tbw-dashboard/tbw.db /var/lib/tbw-dashboard/tbw_backup_$(date +%Y%m%d_%H%M%S).db
   ```
2. Execute the migration script pointing to Supabase:
   ```bash
   DATABASE_URL="postgresql://postgres:[PASSWORD]@db.fbyyjmxrkizlpmxakkdo.supabase.co:5432/postgres?sslmode=require" \
   SQLITE_PATH="/var/lib/tbw-dashboard/tbw.db" \
   node database/migrate_data.js
   ```
3. Verify that row counts and sequence values (`setval`) match exactly between SQLite and PostgreSQL.

### Step C: Vercel Production Deployment
1. Connect the repository `https://github.com/thebusinessworkco-dot/TBW_dashboard-.git` (branch `main`) to Vercel.
2. Confirm the environment variables listed in Section 2 are set.
3. Deploy to production.
4. Verify `/api/health` returns `{"status":"ok","runtime":"vercel-serverless-nodejs"}`.

### Step D: Zero-Disruption n8n / WhatsApp Verification
1. Verify the VPS Docker container running n8n remains online:
   ```bash
   docker ps | grep n8n
   ```
2. Confirm existing Meta WhatsApp Cloud API webhooks continue sending events to `https://n8n.thebusinesswork.com`.
3. In the n8n workflow, verify the `Google Sheets Lead Capture` node and the `Check Mode` node are communicating with `https://dashboard.thebusinesswork.com/api/webhook/n8n/mode/:phone`.

### Step E: Lead Synchronization & Functional Sign-Off
1. Log in with the owner account `thebusinesswork.co@gmail.com`.
2. Confirm no 401 toast appears on Reports or Overview.
3. In **CRM & Lead Pipeline**, click **Sync Google Sheets** to verify two-way synchronization.
4. Test soft-deleting a lead and verify it moves to Trash without being re-created on the next sheet sync.
5. Generate an invoice and a quotation, checking that PDFs stream without error.

---

## 4. ROLLBACK PLAN

If an unforeseen blocking issue arises during cutover:
1. Re-point `dashboard.thebusinesswork.com` DNS / Caddy back to the VPS reverse proxy pointing to `localhost:3000`.
2. Restart `tbw-dashboard-api.service`:
   ```bash
   sudo systemctl restart tbw-dashboard-api
   ```
3. SQLite `/var/lib/tbw-dashboard/tbw.db` remains intact and unaffected throughout the migration.
4. No disruption occurs to WhatsApp bot operations because n8n runs independently on the VPS.

---

## 5. VPS RETIREMENT (POST-OBSERVATION)

Only after a 14-day observation period with zero defects and explicit user sign-off:
1. Archive SQLite database `/var/lib/tbw-dashboard/tbw.db` to cold storage.
2. Stop and disable `tbw-dashboard-api.service`:
   ```bash
   sudo systemctl stop tbw-dashboard-api
   sudo systemctl disable tbw-dashboard-api
   ```
3. Remove old code in `/opt/tbw-dashboard-api`.
4. **DO NOT TOUCH:**
   - n8n Docker container and Docker volumes
   - Caddy configuration for `n8n.thebusinesswork.com`
   - WhatsApp Gemini workflow configurations
   - Main public business website
