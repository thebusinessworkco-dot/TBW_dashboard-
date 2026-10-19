    -- ============================================================================
    -- The Business Work Dashboard v14: Migration 001 - Google Sheets CRM Integration
    -- Adds two-way synchronization columns, soft-deletion safety, tombstones,
    -- sync logs, and configuration tables.
    -- ============================================================================

    -- 1. EXTEND CLIENTS TABLE WITH TWO-WAY SYNC & SOFT DELETION
    ALTER TABLE public.clients
        ADD COLUMN IF NOT EXISTS _tbw_id UUID DEFAULT gen_random_uuid(),
        ADD COLUMN IF NOT EXISTS google_sheet_row_id TEXT,
        ADD COLUMN IF NOT EXISTS google_sheet_synced_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_tbw_id ON public.clients(_tbw_id);
    CREATE INDEX IF NOT EXISTS idx_clients_is_deleted ON public.clients(is_deleted);
    CREATE INDEX IF NOT EXISTS idx_clients_sheet_row ON public.clients(google_sheet_row_id);

    -- 2. GOOGLE SHEETS CONFIGURATION TABLE
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
        column_mapping          JSONB NOT NULL DEFAULT '{
            "_tbw_id": "TBW_ID",
            "name": "Name",
            "whatsapp_phone": "Phone",
            "email": "Email",
            "business_name": "Business Name",
            "requirement": "Requirement",
            "budget": "Budget",
            "lifecycle_status": "Status",
            "next_followup": "Follow Up",
            "created_at": "CapturedAt"
        }'::jsonb,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Seed default config if empty
    INSERT INTO public.google_sheet_config (spreadsheet_id, sheet_name)
    SELECT COALESCE(current_setting('app.google_sheets_spreadsheet_id', true), '1-Placeholder-Spreadsheet-ID'), 'Leads'
    WHERE NOT EXISTS (SELECT 1 FROM public.google_sheet_config);

    -- 3. GOOGLE SHEETS SYNC LOGS & AUDIT TRAIL
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
