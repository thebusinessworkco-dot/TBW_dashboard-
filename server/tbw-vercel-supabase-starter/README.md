# The Business Work — Vercel + Supabase cloud starter

## What this ZIP does / does not do

A **verified-syntax code reference**, not a drop-in full migration. Includes actual Vercel Node Functions for `/api/health` and `/api/auth/me`, an owner-only Supabase token verifier, a parameterized PostgreSQL driver, browser Supabase helpers, a read-only SQLite inventory tool and a safe migration-agent prompt.

**It does NOT migrate the existing CRM, invoices, quotations, inbox, tasks, reports, or SQLite data.** Those require the actual latest codebase + a private, fresh, verified SQLite snapshot. DO NOT deploy this ZIP over the current live dashboard. The existing dashboard still expects all its API endpoints and opaque `tbw_token` sessions; swapping to JWTs without converting all routes will break it. The owner's UID mapping is deliberately not automatic.

## Proposed structure INSIDE the existing Vite project

```text
Dashboard v14/
  api/
    _lib/{db,env,http,auth}.js
    health.js
    auth/me.js
  src/
    lib/
      supabase.js     <-- merge manually from frontend-overlays/lib/supabase.js
      cloud-auth.js   <-- merge manually from frontend-overlays/lib/cloud-auth.js
  database/001_auth_links.sql
  scripts/audit_sqlite.py
  vercel.json          <-- adapt existing SPA settings, don't replace blindly
```

### Preparation

1. Clone current dashboard to a NEW migration branch/worktree, not the live production checkout. Back up changed files.
2. `npm install @supabase/supabase-js pg` in the frontend/Vite root (where Vercel deploys). Check installed Node version and project `type` in `package.json` (ESM required for these `.js` examples).
3. Put `api/` into the Vite/Vercel root. Copy browser helpers into `src/lib` after checking any existing `supabase.js` file; **never overwrite without diffing**.
4. Add Vercel environment variables from `.env.example` in Staging/Preview scope. `DATABASE_URL` must be the Supabase **Transaction pooler** URL (typically port 6543), stored server-side only. Set up SSL certificate validation; do not use `rejectUnauthorized:false`.
5. First migrate/verify the true `public.users` schema, then run `database/001_auth_links.sql`. Add an explicitly verified auth link using a migration approved by the account owner.
6. Review existing `vercel.json`: its SPA fallback must not swallow `/api/*` handlers. Do not overwrite production configs with the provided example. Test `GET /api/health` and `GET /api/auth/me` on a staging preview.
7. Use the included migration prompt with Antigravity to adapt **all** actual business routes and UI authentication consumers. Only when all are converted can `VITE_API_URL=/api` be enabled in production.

### Database backup inventory (read-only)

```bash
python scripts/audit_sqlite.py /path/to/COPIED-verified-backup.db
```

This script does not export table data and refuses to continue if the DB reports integrity problems.

### Important compatibility cautions

- Current dashboard uses an opaque SQLite `tbw_token`; this starter demonstrates a **direct Supabase JWT** strategy and **does not pretend the two are interchangeable**.
- `auth/me` expects PostgreSQL `public.users` with `id,email,name,phone,role,avatar_url,is_active`, and `is_active` as BOOLEAN. Adjust after actual schema migration.
- Reference is owner-only. Multi-user/team role mapping requires a separate vetted authorization design.
- Supabase `getUser(jwt)` remotely validates the token; sign-out does not instantly invalidate already issued access JWTs. If immediate revocation is required, add server-side revocation/session controls.
- Review existing SSE `/api/sse` and WhatsApp bot integration before choosing Vercel Functions; replace long-lived streams with a supported design (e.g. Supabase Realtime or polling) only after testing.
- Vercel API Functions do not have durable local disk. Migrate any uploads to Supabase Storage.
- The Supabase transaction pooler has restrictions around prepared statements and connection/session state. For all new database code, test TLS, pool size, timeouts and transactions.
- Do not alter n8n, Caddy, Meta webhook, DNS, or VPS backend until all tests pass and cutover is explicitly approved.

### Deployment gate (NO AUTO DEPLOY)

`npm run build` plus staging API tests, row counts, referential checks, permissions, WhatsApp integration and a final approved data-write-freeze cutover are prerequisites. Old dashboard backend and database should only be retired once the live dashboard is verified and a rollback plan is safe.
