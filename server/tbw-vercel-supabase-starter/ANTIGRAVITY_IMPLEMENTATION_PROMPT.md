# Prompt for Antigravity / Cursor

Act as a senior full-stack migration engineer. I want to migrate the actual existing The Business Work Dashboard v14 from VPS Express + SQLite to **the current Vercel project** for React/Vite + Vercel Node Functions and **Supabase Postgres + Supabase Auth**, retaining VPS n8n and the existing WhatsApp Gemini bot and Meta webhook unchanged.

Existing GitHub repo: https://github.com/thebusinessworkco-dot/TBW_dashboard-
Frontend: dashboard.thebusinesswork.com
VPS source: /opt/tbw-dashboard-api
SQLite: /var/lib/tbw-dashboard/tbw.db
Owner UID: 0384f5a7-a525-4b6e-9517-200bc5ec11e4
Owner legacy id: 1

A safe reference scaffold is provided with this ZIP, but it is NOT the completed business backend.

1. First inspect EVERY existing backend route, synchronous better-sqlite3 query, transaction, migration, test, and integration. Inspect src/lib/api.js, src/App.jsx, LoginForm.jsx and existing vercel.json. Identify SSE and all long-lived connections. Do not assume they work in serverless. Replace SSE with a practical authenticated short-polling or Supabase Realtime design; verify plan restrictions, ownership, and RLS.
2. Verify a fresh SQLite snapshot via its backup API; do not take an unsafe live file copy. Keep private data and DB snapshots out of repository, chat and Vercel build output.
3. Design *actual* PostgreSQL schema preserving existing tables, IDs, foreign keys, dates, nulls, constraints, indexes and invoice numbering. Do not make up missing tables. Build an idempotent staging data import plus count/integrity verification and final production write-freeze cutover. Use transactions and parameterized queries.
4. Convert all Express routes from synchronous SQLite to async PostgreSQL. Choose either Vercel's supported Express default-export integration or file-based Node Functions; do not run an always-on Express listen server or SQLite in Vercel. Use pg pooled with one connection per warm instance, Supabase transaction pooler SSL and unnamed queries. Do not place server secrets in VITE_ env. Preserve API shapes.
5. Implement secure Supabase login and owner UID mapping, protect EVERY privileged API server-side, and handle JWT expiry and logout (design immediate revocation as required). Never authorize by email only. Do not expose service-role keys or Postgres connection URLs to frontend.
6. Review current Vercel SPA rewrite config; ensure API endpoints are not swallowed by index.html. Validate preview API requests. Existing Vercel env variables and redirects may need updates.
7. Identify n8n WhatsApp webhook routes. Keep Meta webhook unchanged; optionally deliver HMAC-authenticated idempotent outbound event sync from n8n to a new Vercel API only after approval. Do not change n8n services, volumes, Caddy, or bot prompts.
8. Run automated tests plus end-to-end staging tests for all CRM, invoices, quotations, inbox, reports, attachments, scheduling. Do not silently drop incompatible background workers, persistent streams or filesystem writes.
9. Get explicit approval before production database writes, backend restarts, URL/DNS changes or retiring the old backend. Stop old dashboard writes for final delta import. After cutover avoid split-brain; carefully handle rollback with new Postgres writes.
10. Provide full changed-file inventory, migration commands, test output, data verification summary and phased rollback plan. Never claim success without checking production responses.

Implement actual code against the supplied project and request its complete source ZIP if you cannot access the repository. DO NOT deploy scaffold alone to production.
