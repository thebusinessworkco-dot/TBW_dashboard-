# DATABASE INVENTORY: THE BUSINESS WORK DASHBOARD v14

**Audit Date:** October 19, 2026  
**Target Engine:** Supabase PostgreSQL  
**Schema Script:** `database/000_full_schema.sql`  
**Migration Tool:** `database/migrate_data.js`

---

## 1. Schema Summary

The database consists of **28 core application tables** migrated from SQLite, plus **2 cloud security tables** in the `tbw_cloud` schema:

| # | Table Name | Primary Key | Description | Key Indexes & Constraints |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `app_settings` | `key` (TEXT) | System key-value configurations | `PRIMARY KEY (key)` |
| 2 | `services` | `id` (SERIAL) | Service catalog and pricing | `UNIQUE(name)` |
| 3 | `packages` | `id` (SERIAL) | Service packages and bundles | `FK -> services(id)` |
| 4 | `users` | `id` (SERIAL) | Internal agency users and credentials | `UNIQUE(email)`, `CHECK (role IN ...)` |
| 5 | `sessions` | `id` (TEXT) | Opaque session tokens (fallback/legacy) | `FK -> users(id)` |
| 6 | `clients` | `id` (SERIAL) | Leads and customer profiles | `idx_clients_phone`, `idx_clients_lifecycle` |
| 7 | `client_notes` | `id` (SERIAL) | Timestamped client interaction notes | `FK -> clients(id), users(id)` |
| 8 | `lead_events` | `id` (SERIAL) | CRM lead timeline audit trail | `FK -> clients(id), users(id)` |
| 9 | `conversations` | `id` (SERIAL) | WhatsApp conversation state | `idx_conversations_phone`, `CHECK(mode IN ('ai','human'))` |
| 10 | `messages` | `id` (SERIAL) | WhatsApp chat messages | `idx_messages_conv_created`, `idx_messages_wa_id` |
| 11 | `message_delivery_events` | `id` (SERIAL) | Meta delivery receipt history | `FK -> messages(id)` |
| 12 | `conversation_notes` | `id` (SERIAL) | Internal chat thread notes | `FK -> conversations(id), users(id)` |
| 13 | `quick_replies` | `id` (SERIAL) | WhatsApp response templates | `UNIQUE(shortcut)` |
| 14 | `whatsapp_templates` | `id` (SERIAL) | Meta approved business templates | `UNIQUE(name)` |
| 15 | `quotations` | `id` (SERIAL) | Formal customer proposals | `UNIQUE(quotation_number)`, `FK -> clients(id)` |
| 16 | `quotation_items` | `id` (SERIAL) | Line items for quotations | `FK -> quotations(id)` |
| 17 | `invoices` | `id` (SERIAL) | Official tax invoices | `UNIQUE(invoice_number)`, `FK -> clients(id)` |
| 18 | `invoice_items` | `id` (SERIAL) | Line items for invoices | `FK -> invoices(id)` |
| 19 | `payments` | `id` (SERIAL) | Confirmed client payments & receipts | `UNIQUE(receipt_number)`, `FK -> invoices(id), clients(id)` |
| 20 | `projects` | `id` (SERIAL) | Client deliverable projects | `FK -> clients(id), users(id)` |
| 21 | `tasks` | `id` (SERIAL) | Project tasks and action items | `FK -> projects(id), users(id)` |
| 22 | `subscriptions` | `id` (SERIAL) | Recurring MRR billing contracts | `FK -> clients(id)` |
| 23 | `expenses` | `id` (SERIAL) | Agency operational expenditures | `FK -> users(id)` |
| 24 | `appointments` | `id` (SERIAL) | Calendar bookings & discovery calls | `FK -> clients(id), users(id)` |
| 25 | `notifications` | `id` (SERIAL) | Internal team notifications | `FK -> users(id)` |
| 26 | `automation_integrations` | `id` (SERIAL) | n8n workflow execution monitoring | `UNIQUE(workflow_name)` |
| 27 | `audit_logs` | `id` (SERIAL) | Security and mutation audit log | `FK -> users(id)` |
| 28 | `_migrations` | `name` (TEXT) | Migration execution history | `PRIMARY KEY (name)` |
| 29 | `tbw_cloud.auth_links` | `supabase_user_id` (UUID) | Supabase Auth UUID to Legacy User ID | `UNIQUE(supabase_user_id), FK -> users(id)` |
| 30 | `tbw_cloud.revoked_tokens` | `token_hash` (VARCHAR) | SHA-256 JWT revocation denylist | `PRIMARY KEY (token_hash)` |

---

## 2. Table Data Types & Conversion Mapping

| SQLite Type | PostgreSQL Target | Conversion Handling |
| :--- | :--- | :--- |
| `INTEGER` (PK) | `SERIAL` / `INT` | Sequence resynchronized with `setval(..., MAX(id))` |
| `INTEGER` (Boolean) | `BOOLEAN` | `0` -> `FALSE`, `1` -> `TRUE` |
| `TEXT` (Timestamps) | `TIMESTAMP WITH TIME ZONE` | Coerced to ISO 8601 strings; defaults to `CURRENT_TIMESTAMP` |
| `REAL` / `NUMERIC` | `NUMERIC(12, 2)` | Used for financial amounts (`total`, `amount_paid`, `monthly_fee`) |
| `TEXT` (JSON) | `JSONB` | Stored as parsed JSONB structures |

---

## 3. Row Count Verification Baseline (from Verified Snapshot)

* **Source Database:** `server/data/backups/tbw_backup_2026-10-19T15-54-26-703Z.db`
* **Integrity Status:** `ok`
* **Foreign Key Violations:** `0`
* **Baseline Row Counts:**
  * `app_settings`: 13 rows
  * `services`: 15 rows
  * `packages`: 8 rows
  * `users`: 6 rows
  * `clients`: 6 rows
  * `quick_replies`: 6 rows
  * `conversations`: 5 rows
  * `messages`: 12 rows
  * `quotations`: 3 rows
  * `invoices`: 3 rows
  * `payments`: 3 rows
  * `subscriptions`: 3 rows
  * `expenses`: 6 rows
  * `projects`: 3 rows
  * `tasks`: 9 rows
  * `appointments`: 4 rows
  * `automation_integrations`: 3 rows
  * `audit_logs`: 18 rows
