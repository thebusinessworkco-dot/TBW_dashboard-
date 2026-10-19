-- Migration 001: Initial schema for The Business Work
-- ============================================================

-- ============================================================
-- AUTHENTICATION & TEAM
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    name            TEXT NOT NULL,
    phone           TEXT,
    role            TEXT NOT NULL DEFAULT 'viewer'
                    CHECK(role IN ('owner','admin','sales','support','accountant','viewer')),
    avatar_url      TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    last_login_at   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_info     TEXT,
    ip_address      TEXT,
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============================================================
-- CLIENTS & LEADS (CRM)
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    whatsapp_phone  TEXT,
    email           TEXT,
    business_name   TEXT,
    industry        TEXT,
    city            TEXT,
    country         TEXT DEFAULT 'India',
    language        TEXT DEFAULT 'English'
                    CHECK(language IN ('English','Hindi','Hinglish','Marathi')),
    service_category TEXT,
    requirement     TEXT,
    budget          REAL,
    lead_source     TEXT,
    assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    tags            TEXT,
    lifecycle_status TEXT NOT NULL DEFAULT 'new_lead'
                    CHECK(lifecycle_status IN (
                        'new_lead','contacted','qualified',
                        'proposal_sent','negotiation','won','lost','archived'
                    )),
    next_followup   TEXT,
    last_contacted  TEXT,
    wa_contact_id   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone ON clients(whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_clients_assigned ON clients(assigned_to);

CREATE TABLE IF NOT EXISTS client_notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_client_notes_client ON client_notes(client_id);

CREATE TABLE IF NOT EXISTS lead_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    from_value      TEXT,
    to_value        TEXT,
    description     TEXT,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lead_events_client ON lead_events(client_id);

-- ============================================================
-- WHATSAPP CONVERSATIONS & MESSAGES
-- ============================================================

CREATE TABLE IF NOT EXISTS conversations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    wa_conversation_id TEXT,
    phone_number    TEXT NOT NULL,
    contact_name    TEXT,
    mode            TEXT NOT NULL DEFAULT 'ai' CHECK(mode IN ('ai','human')),
    status          TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','archived')),
    assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    labels          TEXT,
    unread_count    INTEGER NOT NULL DEFAULT 0,
    last_message_at TEXT,
    last_message_preview TEXT,
    wa_window_expires TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(assigned_to);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(last_message_at);

CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    wa_message_id   TEXT UNIQUE,
    direction       TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
    sender_type     TEXT NOT NULL CHECK(sender_type IN ('customer','ai','employee')),
    sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    message_type    TEXT NOT NULL DEFAULT 'text'
                    CHECK(message_type IN ('text','image','video','audio','document',
                        'location','contact','sticker','interactive','template','reaction','unknown')),
    content         TEXT,
    media_url       TEXT,
    media_mime_type TEXT,
    caption         TEXT,
    reply_to_id     INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    delivery_status TEXT DEFAULT 'pending'
                    CHECK(delivery_status IN ('pending','sent','delivered','read','failed')),
    error_message   TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_message_id);

CREATE TABLE IF NOT EXISTS message_delivery_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id      INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    status          TEXT NOT NULL,
    wa_timestamp    TEXT,
    error_code      TEXT,
    error_detail    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_delivery_message ON message_delivery_events(message_id);

CREATE TABLE IF NOT EXISTS conversation_notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- QUICK REPLIES & WHATSAPP TEMPLATES
-- ============================================================

CREATE TABLE IF NOT EXISTS quick_replies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    folder          TEXT NOT NULL DEFAULT 'Custom',
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    language        TEXT DEFAULT 'English',
    variables       TEXT,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    language        TEXT NOT NULL DEFAULT 'en',
    category        TEXT,
    status          TEXT DEFAULT 'pending'
                    CHECK(status IN ('pending','approved','rejected','disabled')),
    components      TEXT,
    wa_template_id  TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SERVICES & PACKAGES
-- ============================================================

CREATE TABLE IF NOT EXISTS services (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    category        TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    is_recurring    INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS packages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id      INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    setup_fee       REAL DEFAULT 0,
    monthly_fee     REAL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- QUOTATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS quotations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    quotation_number TEXT NOT NULL UNIQUE,
    client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','sent','viewed','accepted','rejected','expired','revised')),
    package_type    TEXT,
    scope_of_work   TEXT,
    deliverables    TEXT,
    timeline        TEXT,
    payment_milestones TEXT,
    terms           TEXT,
    exclusions      TEXT,
    notes           TEXT,
    discount_type   TEXT CHECK(discount_type IN ('fixed','percentage')),
    discount_value  REAL DEFAULT 0,
    tax_type        TEXT,
    tax_rate        REAL DEFAULT 0,
    currency        TEXT NOT NULL DEFAULT 'INR',
    valid_until     TEXT,
    accepted_at     TEXT,
    accepted_by     TEXT,
    acceptance_token TEXT UNIQUE,
    revision_of     INTEGER REFERENCES quotations(id) ON DELETE SET NULL,
    revision_number INTEGER DEFAULT 1,
    sent_at         TEXT,
    sent_via        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotations_client ON quotations(client_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);

CREATE TABLE IF NOT EXISTS quotation_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    quotation_id    INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    service_id      INTEGER REFERENCES services(id) ON DELETE SET NULL,
    description     TEXT NOT NULL,
    quantity        REAL NOT NULL DEFAULT 1,
    unit_price      REAL NOT NULL DEFAULT 0,
    setup_fee       REAL DEFAULT 0,
    monthly_fee     REAL DEFAULT 0,
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quote ON quotation_items(quotation_id);

-- ============================================================
-- PROJECTS & TASKS
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    quotation_id    INTEGER REFERENCES quotations(id) ON DELETE SET NULL,
    invoice_id      INTEGER,
    assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'planning'
                    CHECK(status IN ('planning','development','testing','client_review','delivered','maintenance','archived')),
    budget          REAL,
    start_date      TEXT,
    due_date        TEXT,
    deliverables    TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    priority        TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
    status          TEXT NOT NULL DEFAULT 'todo'
                    CHECK(status IN ('todo','in_progress','review','done')),
    due_date        TEXT,
    checklist       TEXT,
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);

-- ============================================================
-- INVOICES
-- ============================================================

CREATE TABLE IF NOT EXISTS invoices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number  TEXT NOT NULL UNIQUE,
    client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    quotation_id    INTEGER REFERENCES quotations(id) ON DELETE SET NULL,
    project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','issued','partially_paid','paid','overdue','cancelled','refunded')),
    billing_address TEXT,
    gstin           TEXT,
    issue_date      TEXT NOT NULL,
    due_date        TEXT NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'INR',
    tax_type        TEXT,
    tax_rate        REAL DEFAULT 0,
    discount_type   TEXT CHECK(discount_type IN ('fixed','percentage')),
    discount_value  REAL DEFAULT 0,
    additional_charges REAL DEFAULT 0,
    additional_charges_note TEXT,
    subtotal        REAL NOT NULL DEFAULT 0,
    tax_amount      REAL NOT NULL DEFAULT 0,
    total           REAL NOT NULL DEFAULT 0,
    amount_paid     REAL NOT NULL DEFAULT 0,
    balance_due     REAL NOT NULL DEFAULT 0,
    payment_instructions TEXT,
    terms           TEXT,
    notes           TEXT,
    sent_at         TEXT,
    sent_via        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);

CREATE TABLE IF NOT EXISTS invoice_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id      INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description     TEXT NOT NULL,
    quantity        REAL NOT NULL DEFAULT 1,
    unit_price      REAL NOT NULL DEFAULT 0,
    amount          REAL NOT NULL DEFAULT 0,
    sort_order      INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- ============================================================
-- PAYMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id      INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    amount          REAL NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'INR',
    method          TEXT CHECK(method IN ('upi','bank_transfer','cash','cheque','gateway','other')),
    reference_id    TEXT,
    gateway_order_id TEXT,
    status          TEXT NOT NULL DEFAULT 'confirmed'
                    CHECK(status IN ('pending','confirmed','failed','refunded')),
    payment_date    TEXT NOT NULL,
    notes           TEXT,
    recorded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    receipt_number  TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference_id) WHERE reference_id IS NOT NULL;

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    service_id      INTEGER REFERENCES services(id) ON DELETE SET NULL,
    package_id      INTEGER REFERENCES packages(id) ON DELETE SET NULL,
    quotation_id    INTEGER REFERENCES quotations(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    billing_cycle   TEXT NOT NULL DEFAULT 'monthly'
                    CHECK(billing_cycle IN ('monthly','quarterly','annual')),
    monthly_fee     REAL NOT NULL DEFAULT 0,
    setup_fee       REAL DEFAULT 0,
    provider_cost   REAL DEFAULT 0,
    maintenance_cost REAL DEFAULT 0,
    start_date      TEXT NOT NULL,
    next_billing    TEXT,
    contract_end    TEXT,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','paused','cancelled','expired')),
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_client ON subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_billing ON subscriptions(next_billing);

-- ============================================================
-- EXPENSES
-- ============================================================

CREATE TABLE IF NOT EXISTS expenses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    category        TEXT NOT NULL,
    description     TEXT NOT NULL,
    amount          REAL NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'INR',
    expense_date    TEXT NOT NULL,
    is_recurring    INTEGER DEFAULT 0,
    vendor          TEXT,
    reference       TEXT,
    receipt_url     TEXT,
    recorded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT,
    link            TEXT,
    is_read         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- ============================================================
-- AUTOMATION INTEGRATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_integrations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_name   TEXT NOT NULL,
    workflow_id     TEXT,
    type            TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    last_execution  TEXT,
    last_status     TEXT,
    error_summary   TEXT,
    related_client  INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       INTEGER,
    details         TEXT,
    ip_address      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);

-- ============================================================
-- APPLICATION SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
    ('company_name', 'The Business Work'),
    ('company_tagline', 'We Make Business Simpler.'),
    ('company_website', 'https://www.thebusinesswork.com'),
    ('company_email', 'hello@thebusinesswork.com'),
    ('company_phone', ''),
    ('company_address', ''),
    ('company_gstin', ''),
    ('gst_registered', 'false'),
    ('default_currency', 'INR'),
    ('default_timezone', 'Asia/Kolkata'),
    ('default_tax_rate', '18'),
    ('default_conversation_mode', 'ai'),
    ('invoice_prefix', 'TBW-INV'),
    ('quotation_prefix', 'TBW-QT'),
    ('invoice_terms', 'Payment due within the specified period.'),
    ('quotation_terms', 'This quotation is valid for the period specified. Prices are subject to change after expiry.');

-- ============================================================
-- MIGRATIONS TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS _migrations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    applied_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed services catalog
INSERT OR IGNORE INTO services (id, category, name, description, is_recurring) VALUES
    (1, 'AI Agents & Chatbots', 'AI Sales Agents', 'Intelligent sales agents that qualify leads and book meetings', 1),
    (2, 'AI Agents & Chatbots', 'AI Customer Support Agents', 'Automated customer support with natural language understanding', 1),
    (3, 'AI Agents & Chatbots', 'Website AI Chatbots', 'Smart chatbot widgets for websites', 1),
    (4, 'AI Agents & Chatbots', 'AI Lead Qualification', 'Automated lead scoring and qualification', 1),
    (5, 'AI Agents & Chatbots', 'AI Voice Agents', 'Voice-based AI assistants for phone support', 1),
    (6, 'AI Agents & Chatbots', 'AI Appointment Booking Agents', 'Automated appointment scheduling bots', 1),
    (7, 'CRM & Sales Automation', 'CRM Setup & Customization', 'Full CRM implementation and configuration', 0),
    (8, 'CRM & Sales Automation', 'Lead Management', 'Lead tracking, scoring and routing systems', 0),
    (9, 'CRM & Sales Automation', 'Automated Follow-ups', 'Automated email and message follow-up sequences', 1),
    (10, 'CRM & Sales Automation', 'Sales Pipeline Automation', 'Automated deal tracking and pipeline management', 0),
    (11, 'CRM & Sales Automation', 'Lead Assignment & Notifications', 'Automated lead distribution and alert systems', 0),
    (12, 'CRM & Sales Automation', 'Sales Reporting', 'Custom sales dashboards and reporting', 0),
    (13, 'Business Workflow Automation', 'Form-to-CRM Automation', 'Automatic data capture from forms to CRM', 0),
    (14, 'Business Workflow Automation', 'Email Automation', 'Automated email workflows and sequences', 1),
    (15, 'Business Workflow Automation', 'Google Sheets Automation', 'Spreadsheet automation and integrations', 0),
    (16, 'Business Workflow Automation', 'Appointment & Calendar Automation', 'Calendar sync and appointment workflows', 0),
    (17, 'Business Workflow Automation', 'Invoice & Document Workflows', 'Automated document generation and routing', 0),
    (18, 'Business Workflow Automation', 'Business App Integrations', 'Custom integrations between business tools', 0),
    (19, 'WhatsApp & Social Automation', 'WhatsApp Business Automation', 'Full WhatsApp Business API setup and automation', 1),
    (20, 'WhatsApp & Social Automation', 'WhatsApp AI Chat', 'AI-powered WhatsApp conversations', 1),
    (21, 'WhatsApp & Social Automation', 'Notifications & Reminders', 'Automated WhatsApp notification system', 1),
    (22, 'WhatsApp & Social Automation', 'Instagram DM Automation', 'Instagram direct message automation', 1),
    (23, 'WhatsApp & Social Automation', 'Social Media Lead Capture', 'Social media lead generation automation', 0),
    (24, 'WhatsApp & Social Automation', 'Customer Follow-up Messages', 'Automated customer engagement messages', 1);
