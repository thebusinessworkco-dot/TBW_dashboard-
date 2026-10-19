-- Reviewed safe initial schema: no dummy owner and no unverified contact details.
-- Use ONLY after confirming the public schema has no existing dashboard tables.
-- ==============================================================================
-- THE BUSINESS WORK (DASHBOARD v14) - POSTGRESQL PRODUCTION & STAGING SCHEMA
-- Compatible with Supabase Postgres, Transaction Pooler, and Vercel Node Functions
-- ==============================================================================

BEGIN;

-- 1. AUTHENTICATION & TEAM
CREATE TABLE IF NOT EXISTS public.users (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    name            TEXT NOT NULL,
    phone           TEXT,
    role            TEXT NOT NULL DEFAULT 'viewer'
                    CHECK(role IN ('owner','admin','sales','support','accountant','viewer')),
    avatar_url      TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessions (
    id              TEXT PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_info     TEXT,
    ip_address      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON public.sessions(expires_at);

-- 2. SUPABASE AUTH INTEGRATION & IMMEDIATE TOKEN REVOCATION (tbw_cloud schema)
CREATE SCHEMA IF NOT EXISTS tbw_cloud;

CREATE TABLE IF NOT EXISTS tbw_cloud.auth_links (
    supabase_user_id UUID PRIMARY KEY,
    legacy_user_id   BIGINT NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tbw_cloud.revoked_tokens (
    token_hash       TEXT PRIMARY KEY,
    user_id          BIGINT REFERENCES public.users(id) ON DELETE CASCADE,
    expires_at       TIMESTAMPTZ NOT NULL,
    revoked_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON tbw_cloud.revoked_tokens(expires_at);

-- 3. CLIENTS & LEADS (CRM)
CREATE TABLE IF NOT EXISTS public.clients (
    id               BIGSERIAL PRIMARY KEY,
    name             TEXT NOT NULL,
    whatsapp_phone   TEXT,
    email            TEXT,
    business_name    TEXT,
    industry         TEXT,
    city             TEXT,
    country          TEXT DEFAULT 'India',
    language         TEXT DEFAULT 'English'
                     CHECK(language IN ('English','Hindi','Hinglish','Marathi')),
    service_category TEXT,
    requirement      TEXT,
    budget           DOUBLE PRECISION,
    lead_source      TEXT,
    assigned_to      BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    tags             TEXT,
    lifecycle_status TEXT NOT NULL DEFAULT 'new_lead'
                     CHECK(lifecycle_status IN (
                         'new_lead','contacted','qualified',
                         'proposal_sent','negotiation','won','lost','archived'
                     )),
    next_followup    TIMESTAMPTZ,
    last_contacted   TIMESTAMPTZ,
    wa_contact_id    TEXT,
    _tbw_id          UUID DEFAULT gen_random_uuid() UNIQUE,
    google_sheet_row_id TEXT,
    google_sheet_synced_at TIMESTAMPTZ,
    is_deleted       BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at       TIMESTAMPTZ,
    deleted_by       BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone ON public.clients(whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_status ON public.clients(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_clients_assigned ON public.clients(assigned_to);
CREATE INDEX IF NOT EXISTS idx_clients_is_deleted ON public.clients(is_deleted);
CREATE INDEX IF NOT EXISTS idx_clients_sheet_row ON public.clients(google_sheet_row_id);

CREATE TABLE IF NOT EXISTS public.google_sheet_config (
    id                      SERIAL PRIMARY KEY,
    spreadsheet_id          TEXT NOT NULL,
    sheet_name              TEXT NOT NULL DEFAULT 'Leads',
    header_row              INTEGER NOT NULL DEFAULT 1,
    auto_sync_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    sync_interval_minutes   INTEGER NOT NULL DEFAULT 15,
    last_sync_at            TIMESTAMPTZ,
    last_sync_status        TEXT DEFAULT 'idle',
    last_error              TEXT,
    column_mapping          JSONB NOT NULL DEFAULT '{"_tbw_id":"TBW_ID","name":"Name","whatsapp_phone":"Phone","email":"Email","business_name":"Business Name","requirement":"Requirement","budget":"Budget","lifecycle_status":"Status","next_followup":"Follow Up","created_at":"CapturedAt"}'::jsonb,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.google_sheet_sync_logs (
    id              BIGSERIAL PRIMARY KEY,
    sync_type       TEXT NOT NULL CHECK(sync_type IN ('inbound', 'outbound', 'bidirectional')),
    status          TEXT NOT NULL CHECK(status IN ('success', 'partial', 'failed', 'config_required')),
    rows_imported   INTEGER NOT NULL DEFAULT 0,
    rows_exported   INTEGER NOT NULL DEFAULT 0,
    rows_updated    INTEGER NOT NULL DEFAULT 0,
    details         JSONB DEFAULT '{}'::jsonb,
    error_message   TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    triggered_by    BIGINT REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sheet_logs_started ON public.google_sheet_sync_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sheet_logs_status ON public.google_sheet_sync_logs(status);

CREATE TABLE IF NOT EXISTS public.client_notes (
    id              BIGSERIAL PRIMARY KEY,
    client_id       BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    user_id         BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_notes_client ON public.client_notes(client_id);

CREATE TABLE IF NOT EXISTS public.lead_events (
    id              BIGSERIAL PRIMARY KEY,
    client_id       BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    from_value      TEXT,
    to_value        TEXT,
    description     TEXT,
    user_id         BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_events_client ON public.lead_events(client_id);

-- 4. WHATSAPP CONVERSATIONS & MESSAGES
CREATE TABLE IF NOT EXISTS public.conversations (
    id                   BIGSERIAL PRIMARY KEY,
    client_id            BIGINT REFERENCES public.clients(id) ON DELETE SET NULL,
    wa_conversation_id   TEXT,
    phone_number         TEXT NOT NULL,
    contact_name         TEXT,
    mode                 TEXT NOT NULL DEFAULT 'ai' CHECK(mode IN ('ai','human')),
    status               TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','archived')),
    assigned_to          BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    labels               TEXT,
    unread_count         INTEGER NOT NULL DEFAULT 0,
    last_message_at      TIMESTAMPTZ,
    last_message_preview TEXT,
    wa_window_expires    TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_phone ON public.conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON public.conversations(assigned_to);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON public.conversations(last_message_at);

CREATE TABLE IF NOT EXISTS public.messages (
    id              BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    wa_message_id   TEXT UNIQUE,
    direction       TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
    sender_type     TEXT NOT NULL CHECK(sender_type IN ('customer','ai','employee')),
    sender_id       BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    message_type    TEXT NOT NULL DEFAULT 'text'
                    CHECK(message_type IN ('text','image','video','audio','document',
                        'location','contact','sticker','interactive','template','reaction','unknown')),
    content         TEXT,
    media_url       TEXT,
    media_mime_type TEXT,
    caption         TEXT,
    reply_to_id     BIGINT REFERENCES public.messages(id) ON DELETE SET NULL,
    delivery_status TEXT DEFAULT 'pending'
                    CHECK(delivery_status IN ('pending','sent','delivered','read','failed')),
    error_message   TEXT,
    metadata        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON public.messages(wa_message_id);

CREATE TABLE IF NOT EXISTS public.message_delivery_events (
    id              BIGSERIAL PRIMARY KEY,
    message_id      BIGINT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    status          TEXT NOT NULL,
    wa_timestamp    TIMESTAMPTZ,
    error_code      TEXT,
    error_detail    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_message ON public.message_delivery_events(message_id);

CREATE TABLE IF NOT EXISTS public.conversation_notes (
    id              BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id         BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. QUICK REPLIES & WHATSAPP TEMPLATES
CREATE TABLE IF NOT EXISTS public.quick_replies (
    id              BIGSERIAL PRIMARY KEY,
    folder          TEXT NOT NULL DEFAULT 'Custom',
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    language        TEXT DEFAULT 'English',
    variables       TEXT,
    created_by      BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    language        TEXT NOT NULL DEFAULT 'en',
    category        TEXT,
    status          TEXT DEFAULT 'pending'
                    CHECK(status IN ('pending','approved','rejected','disabled')),
    components      TEXT,
    wa_template_id  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. SERVICES & PACKAGES
CREATE TABLE IF NOT EXISTS public.services (
    id              BIGSERIAL PRIMARY KEY,
    category        TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    is_recurring    BOOLEAN NOT NULL DEFAULT false,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.packages (
    id              BIGSERIAL PRIMARY KEY,
    service_id      BIGINT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    setup_fee       DOUBLE PRECISION DEFAULT 0,
    monthly_fee     DOUBLE PRECISION DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. QUOTATIONS
CREATE TABLE IF NOT EXISTS public.quotations (
    id                 BIGSERIAL PRIMARY KEY,
    quotation_number   TEXT NOT NULL UNIQUE,
    client_id          BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
    created_by         BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK(status IN ('draft','sent','viewed','accepted','rejected','expired','revised')),
    package_type       TEXT,
    scope_of_work      TEXT,
    deliverables       TEXT,
    timeline           TEXT,
    payment_milestones TEXT,
    terms              TEXT,
    exclusions         TEXT,
    notes              TEXT,
    discount_type      TEXT CHECK(discount_type IN ('fixed','percentage')),
    discount_value     DOUBLE PRECISION DEFAULT 0,
    tax_type           TEXT,
    tax_rate           DOUBLE PRECISION DEFAULT 0,
    currency           TEXT NOT NULL DEFAULT 'INR',
    valid_until        TIMESTAMPTZ,
    accepted_at        TIMESTAMPTZ,
    accepted_by        TEXT,
    acceptance_token   TEXT UNIQUE,
    revision_of        BIGINT REFERENCES public.quotations(id) ON DELETE SET NULL,
    revision_number    INTEGER DEFAULT 1,
    sent_at            TIMESTAMPTZ,
    sent_via           TEXT,
    token_expires_at   TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotations_client ON public.quotations(client_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON public.quotations(status);

CREATE TABLE IF NOT EXISTS public.quotation_items (
    id              BIGSERIAL PRIMARY KEY,
    quotation_id    BIGINT NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
    service_id      BIGINT REFERENCES public.services(id) ON DELETE SET NULL,
    description     TEXT NOT NULL,
    quantity        DOUBLE PRECISION NOT NULL DEFAULT 1,
    unit_price      DOUBLE PRECISION NOT NULL DEFAULT 0,
    setup_fee       DOUBLE PRECISION DEFAULT 0,
    monthly_fee     DOUBLE PRECISION DEFAULT 0,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quote ON public.quotation_items(quotation_id);

-- 8. PROJECTS & TASKS
CREATE TABLE IF NOT EXISTS public.projects (
    id              BIGSERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    client_id       BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
    quotation_id    BIGINT REFERENCES public.quotations(id) ON DELETE SET NULL,
    invoice_id      BIGINT,
    assigned_to     BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'planning'
                    CHECK(status IN ('planning','development','testing','client_review','delivered','maintenance','archived')),
    budget          DOUBLE PRECISION,
    start_date      TIMESTAMPTZ,
    due_date        TIMESTAMPTZ,
    deliverables    TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_client ON public.projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);

CREATE TABLE IF NOT EXISTS public.tasks (
    id              BIGSERIAL PRIMARY KEY,
    project_id      BIGINT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    assigned_to     BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    priority        TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
    status          TEXT NOT NULL DEFAULT 'todo'
                    CHECK(status IN ('todo','in_progress','review','done')),
    due_date        TIMESTAMPTZ,
    checklist       TEXT,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON public.tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON public.tasks(assigned_to);

-- 9. INVOICES
CREATE TABLE IF NOT EXISTS public.invoices (
    id                      BIGSERIAL PRIMARY KEY,
    invoice_number          TEXT NOT NULL UNIQUE,
    client_id               BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
    quotation_id            BIGINT REFERENCES public.quotations(id) ON DELETE SET NULL,
    project_id              BIGINT REFERENCES public.projects(id) ON DELETE SET NULL,
    created_by              BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK(status IN ('draft','issued','partially_paid','paid','overdue','cancelled','refunded')),
    billing_address         TEXT,
    gstin                   TEXT,
    issue_date              TEXT NOT NULL,
    due_date                TEXT NOT NULL,
    currency                TEXT NOT NULL DEFAULT 'INR',
    tax_type                TEXT,
    tax_rate                DOUBLE PRECISION DEFAULT 0,
    discount_type           TEXT CHECK(discount_type IN ('fixed','percentage')),
    discount_value          DOUBLE PRECISION DEFAULT 0,
    additional_charges      DOUBLE PRECISION DEFAULT 0,
    additional_charges_note TEXT,
    subtotal                DOUBLE PRECISION NOT NULL DEFAULT 0,
    tax_amount              DOUBLE PRECISION NOT NULL DEFAULT 0,
    total                   DOUBLE PRECISION NOT NULL DEFAULT 0,
    amount_paid             DOUBLE PRECISION NOT NULL DEFAULT 0,
    balance_due             DOUBLE PRECISION NOT NULL DEFAULT 0,
    payment_instructions    TEXT,
    terms                   TEXT,
    notes                   TEXT,
    sent_at                 TIMESTAMPTZ,
    sent_via                TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON public.invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON public.invoices(due_date);

CREATE TABLE IF NOT EXISTS public.invoice_items (
    id              BIGSERIAL PRIMARY KEY,
    invoice_id      BIGINT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    description     TEXT NOT NULL,
    quantity        DOUBLE PRECISION NOT NULL DEFAULT 1,
    unit_price      DOUBLE PRECISION NOT NULL DEFAULT 0,
    amount          DOUBLE PRECISION NOT NULL DEFAULT 0,
    sort_order      INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);

-- 10. PAYMENTS
CREATE TABLE IF NOT EXISTS public.payments (
    id               BIGSERIAL PRIMARY KEY,
    invoice_id       BIGINT REFERENCES public.invoices(id) ON DELETE SET NULL,
    client_id        BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
    amount           DOUBLE PRECISION NOT NULL,
    currency         TEXT NOT NULL DEFAULT 'INR',
    method           TEXT CHECK(method IN ('upi','bank_transfer','cash','cheque','gateway','other')),
    reference_id     TEXT,
    gateway_order_id TEXT,
    status           TEXT NOT NULL DEFAULT 'confirmed'
                     CHECK(status IN ('pending','confirmed','failed','refunded')),
    payment_date     TIMESTAMPTZ NOT NULL,
    notes            TEXT,
    recorded_by      BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    receipt_number   TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON public.payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_client ON public.payments(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_reference ON public.payments(reference_id) WHERE reference_id IS NOT NULL;

-- 11. SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id               BIGSERIAL PRIMARY KEY,
    client_id        BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
    service_id       BIGINT REFERENCES public.services(id) ON DELETE SET NULL,
    package_id       BIGINT REFERENCES public.packages(id) ON DELETE SET NULL,
    quotation_id     BIGINT REFERENCES public.quotations(id) ON DELETE SET NULL,
    name             TEXT NOT NULL,
    billing_cycle    TEXT NOT NULL DEFAULT 'monthly'
                     CHECK(billing_cycle IN ('monthly','quarterly','annual')),
    monthly_fee      DOUBLE PRECISION NOT NULL DEFAULT 0,
    setup_fee        DOUBLE PRECISION DEFAULT 0,
    provider_cost    DOUBLE PRECISION DEFAULT 0,
    maintenance_cost DOUBLE PRECISION DEFAULT 0,
    start_date       TIMESTAMPTZ NOT NULL,
    next_billing     TIMESTAMPTZ,
    contract_end     TIMESTAMPTZ,
    status           TEXT NOT NULL DEFAULT 'active'
                     CHECK(status IN ('active','paused','cancelled','expired')),
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_client ON public.subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_billing ON public.subscriptions(next_billing);

-- 12. EXPENSES
CREATE TABLE IF NOT EXISTS public.expenses (
    id           BIGSERIAL PRIMARY KEY,
    category     TEXT NOT NULL,
    description  TEXT NOT NULL,
    amount       DOUBLE PRECISION NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'INR',
    expense_date TIMESTAMPTZ NOT NULL,
    is_recurring BOOLEAN DEFAULT false,
    vendor       TEXT,
    reference    TEXT,
    receipt_url  TEXT,
    recorded_by  BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses(category);

-- 13. APPOINTMENTS
CREATE TABLE IF NOT EXISTS public.appointments (
    id           BIGSERIAL PRIMARY KEY,
    client_id    BIGINT REFERENCES public.clients(id) ON DELETE CASCADE,
    user_id      BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    type         TEXT NOT NULL DEFAULT 'discovery_call'
                 CHECK(type IN ('discovery_call','demo','proposal_review','onboarding','support','meeting')),
    status       TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK(status IN ('scheduled','completed','cancelled','rescheduled','no_show')),
    start_time   TIMESTAMPTZ NOT NULL,
    end_time     TIMESTAMPTZ NOT NULL,
    location     TEXT,
    meeting_link TEXT,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointments_client ON public.appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_user ON public.appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON public.appointments(start_time);

-- 14. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    link       TEXT,
    is_read    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read);

-- 15. AUTOMATION INTEGRATIONS
CREATE TABLE IF NOT EXISTS public.automation_integrations (
    id             BIGSERIAL PRIMARY KEY,
    workflow_name  TEXT NOT NULL,
    workflow_id    TEXT,
    type           TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    last_execution TIMESTAMPTZ,
    last_status    TEXT,
    error_summary  TEXT,
    related_client BIGINT REFERENCES public.clients(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 16. AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   BIGINT,
    details     TEXT,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON public.audit_logs(created_at);

-- 17. APPLICATION SETTINGS
CREATE TABLE IF NOT EXISTS public.app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 18. MIGRATIONS TRACKING
CREATE TABLE IF NOT EXISTS public._migrations (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Initial default settings
INSERT INTO public.app_settings (key, value) VALUES
    ('company_name', 'The Business Work'),
    ('company_tagline', 'We Make Business Simpler.'),
    ('company_website', 'https://www.thebusinesswork.com'),
    ('default_currency', 'INR'),
    ('default_timezone', 'Asia/Kolkata'),
    ('default_conversation_mode', 'ai'),
    ('invoice_prefix', 'TBW-INV'),
    ('quotation_prefix', 'TBW-QT'),
    ('invoice_terms', 'Payment due within the specified period.'),
    ('quotation_terms', 'This quotation is valid for the period specified. Prices are subject to change after expiry.')
ON CONFLICT (key) DO NOTHING;

-- Owner mapping intentionally deferred until the real users table has been migrated.
-- Do not insert a placeholder user or auth link.

-- SECURITY: SQL Editor-created tables are not automatically protected by RLS.
-- Enable RLS on all dashboard business tables, with no direct-client policies.
-- Vercel server-side DB connections can use the privileged server connection;
-- direct browser reads/writes must remain blocked until reviewed policies exist.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_sheet_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_sheet_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;

-- Restrict tbw_cloud schema from anonymous or ambient access
REVOKE ALL ON SCHEMA tbw_cloud FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA tbw_cloud FROM PUBLIC, anon, authenticated;

COMMIT;
