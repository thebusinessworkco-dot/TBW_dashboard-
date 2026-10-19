# REPOSITORY AUDIT: THE BUSINESS WORK DASHBOARD v14

**Audit Date:** October 19, 2026  
**Repository:** `https://github.com/thebusinessworkco-dot/TBW_dashboard-.git`  
**Latest Reviewed Commit:** `2112991` (`feat: migrate backend to Vercel Serverless Express + Supabase Postgres & Auth`)  
**Branch:** `main`  
**Local Working Directory:** `C:\Users\amanr\Downloads\Dashboard v14\Dashboard v14`

---

## 1. Executive Summary

This repository contains the complete frontend and backend implementation of **The Business Work Dashboard v14**, an internal business operations, CRM, invoicing, financial intelligence, and WhatsApp automation dashboard.

The application is transitioning from a monolithic VPS-hosted Express + SQLite architecture (`/opt/tbw-dashboard-api`, `/var/lib/tbw-dashboard/tbw.db`) to a unified, serverless architecture on **Vercel** with **Supabase PostgreSQL & Supabase Auth**, while retaining VPS **n8n** (`https://n8n.thebusinesswork.com`), Docker, Caddy, Meta WhatsApp Cloud API webhooks, and the Gemini bot untouched.

---

## 2. Tracked Files & Directory Structure

```
Dashboard v14/
├── api/                           # Vercel Serverless Function entrypoint & routers
│   ├── _lib/                      # Core libraries (auth, db, env, http)
│   ├── middleware/                # Express middleware (auth, rbac, rateLimit, validate, errorHandler)
│   ├── routes/                    # 24 asynchronous PostgreSQL routers
│   ├── services/                  # PDF streaming, WhatsApp dispatcher, realtime broker
│   ├── utils/                     # Logger, crypto, audit helpers
│   ├── health.js                  # Standalone serverless health check
│   └── index.js                   # Unified Express default export
├── database/                      # PostgreSQL database assets & migration scripts
│   ├── 000_full_schema.sql        # Complete 28-table PostgreSQL schema + auth_links + revoked_tokens
│   └── migrate_data.js            # Idempotent SQLite -> Postgres ETL with row count verification
├── docs/                          # Comprehensive technical, audit, and testing documentation
├── public/                        # Static assets (favicons, SVG icon sprites)
├── server/                        # Legacy VPS Express codebase (preserved for reference & rollback)
│   ├── src/                       # Legacy SQLite routes, controllers, and services
│   ├── test/                      # Legacy SQLite test suites (Stages 3-10)
│   └── tbw-vercel-supabase-starter/ # Reference starter scaffold
├── src/                           # React 19 + Vite frontend application
│   ├── assets/                    # Static image assets
│   ├── components/                # UI components (LoginForm, TopBar, SideRail, Modals, Brand, etc.)
│   ├── data/                      # Legacy demo datasets (seed.js)
│   ├── lib/                       # Frontend libraries (api.js, cloud-auth.js, supabase.js, store.js)
│   ├── pages/                     # 15 dashboard views (Overview, Contacts, Quotations, Invoices, etc.)
│   └── styles/                    # Vanilla CSS design system (base.css, shell.css, overview.css, pages.css)
├── test/                          # Serverless integration test suites
│   └── serverless_api_test.js     # 17 automated end-to-end routing & security tests
├── package.json                   # Root package manifest (Vite + Vercel serverless dependencies)
├── vercel.json                    # Vercel deployment configuration with explicit API rewrites
└── vite.config.js                 # Vite bundler configuration
```

---

## 3. Package Manifests & Dependencies

### Root Manifest (`package.json`)
* **Framework:** React `19.2.8` + React DOM `19.2.8`
* **Bundler:** Vite `8.3.0` with `@vitejs/plugin-react` `6.1.1`
* **Serverless Backend Dependencies:**
  * `express`: `^5.3.0` (Vercel serverless Express entrypoint)
  * `pg`: `^8.23.1` (PostgreSQL client with connection pooling)
  * `@supabase/supabase-js`: `^2.118.0` (Supabase Auth and Realtime client)
  * `bcryptjs`: `^3.0.3` (Password hashing)
  * `cookie-parser`: `^1.4.7` (Session cookie extraction)
  * `cors`: `^2.8.6` (CORS headers)
  * `helmet`: `^8.3.0` (HTTP security headers)
  * `pdfkit`: `^0.20.2` (In-memory PDF streaming)
  * `zod`: `^4.6.7` (Schema validation)
  * `dotenv`: `^18.0.8` (Environment variable loading)

---

## 4. Deployment Configuration Audit

### `vercel.json`
* **Build Command:** `npm run build`
* **Output Directory:** `dist`
* **Framework:** `vite`
* **Rewrites:**
  ```json
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.js" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
  ```
* **Security Headers:**
  * `X-Content-Type-Options: nosniff`
  * `X-Frame-Options: DENY`
  * `X-XSS-Protection: 1; mode=block`
  * `Referrer-Policy: strict-origin-when-cross-origin`
  * `Cache-Control: public, max-age=31536000, immutable` for `/assets/(.*)`

### `.vercelignore` & `.gitignore`
* Strictly excludes all SQLite database files (`*.db`, `*.db-wal`, `*.db-shm`), backups, `.env*` secret files, and the legacy VPS `server/` directory from Vercel deployment bundles and Git commits.

---

## 5. Security & Environment Variable Classification

| Environment Variable | Scope | Purpose | Status |
| :--- | :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Frontend (Public) | Supabase project URL | Publicly safe |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend (Public) | Supabase anon/publishable key | Publicly safe |
| `VITE_API_URL` | Frontend (Public) | API base URL (defaults to `""` for relative Vercel paths) | Configured |
| `DATABASE_URL` | Serverless (Private) | Supabase PostgreSQL Connection Pooler URL (`:6543`) | Required server-side |
| `SUPABASE_URL` | Serverless (Private) | Supabase project URL | Required server-side |
| `SUPABASE_PUBLISHABLE_KEY` | Serverless (Private) | Supabase publishable key for JWT verification | Required server-side |
| `TBW_OWNER_SUPABASE_UID` | Serverless (Private) | Owner Supabase UID (`0384f5a7-a525-4b6e-9517-200bc5ec11e4`) | Required server-side |
| `TBW_OWNER_LEGACY_ID` | Serverless (Private) | Owner legacy database ID (`1`) | Required server-side |
| `N8N_API_KEY` | Serverless (Private) | Shared secret for n8n webhook authentication | Required server-side |
| `SESSION_SECRET` | Serverless (Private) | Cookie/token encryption secret (min 32 chars) | Required server-side |
| `PG_SSL_REJECT_UNAUTHORIZED` | Serverless (Private) | SSL certificate validation (`false` for pooler) | Defaults to `false` |
