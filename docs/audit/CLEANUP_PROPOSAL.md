# CODE CLEANUP PROPOSAL & SAFE RETIREMENT PLAN

**Audit Date:** October 19, 2026  
**Policy:** Non-destructive. No files will be permanently deleted without explicit user sign-off. Original legacy files remain preserved in Git history.

---

## 1. Candidate Items for Safe Retirement (Post-Cutover)

| Item / Directory | Nature | Reason for Retirement | Dependencies / Impact | Proposed Action |
| :--- | :--- | :--- | :--- | :--- |
| `src/data/seed.js` | Demo data file | Contains fake banking template data (`Code XR`, `Dhaka`, `WALLETS`, `BALANCE_USD`). No longer used by production views. | Referenced by test/demo components. | Refactor `App.jsx` to eliminate runtime reliance; archive file. |
| `server/` (VPS codebase) | Legacy backend | Monolithic Express + SQLite server hosted on VPS systemd. Replaced by `api/` serverless functions. | VPS systemd service `tbw-dashboard-api`. | Retain untouched on VPS during staging and observation period. Retire only after final cutover approval. |
| `server/tbw-vercel-supabase-starter/` | Reference scaffold | Provided as initial guidance scaffold; full implementation is now active in root `api/` and `src/`. | None. | Archive to documentation or remove after production verification. |
| `public/Screen Recording 2026-10-18...mov` | Large static binary asset | Unused 20MB screen recording accidentally committed to `public/`. | Not referenced by frontend code. | Propose removing from public web build bundle to save Vercel build time. |

---

## 2. Protected Non-Retirable Components (STRICTLY PRESERVED)

Under NO circumstances will any of the following be modified, cleaned up, or retired:

1. **VPS n8n Workflow Engine:** `https://n8n.thebusinesswork.com`
2. **Meta WhatsApp Cloud API Webhook:** Retains direct connectivity to VPS n8n.
3. **VPS Docker Containers & Volumes:** Contains n8n workflows and encrypted credentials.
4. **VPS Caddy Webserver & SSL:** Continues reverse-proxying `n8n.thebusinesswork.com`.
5. **Gemini AI Automation & Prompts:** Unaltered within n8n workflows.
6. **Public Business Website:** `thebusinesswork.com` (hosted separately).
7. **SQLite Database Snapshot:** `/var/lib/tbw-dashboard/tbw.db` remains archived for rollback safety.

---

## 3. Explicit Approval Protocol

Before executing any deletion or retiring legacy services:
1. Verify 100% production response checks on Vercel (`dashboard.thebusinesswork.com`).
2. Verify Supabase record counts match the final SQLite snapshot.
3. Obtain written approval from the project owner before executing `systemctl stop tbw-dashboard-api`.
