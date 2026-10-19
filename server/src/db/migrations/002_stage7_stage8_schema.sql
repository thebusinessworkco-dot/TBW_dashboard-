-- Migration 002: Appointments, reminders, and hardened quote tokens for Stage 7 & 8
-- ==============================================================================

CREATE TABLE IF NOT EXISTS appointments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    type            TEXT NOT NULL DEFAULT 'discovery_call'
                    CHECK(type IN ('discovery_call','demo','proposal_review','onboarding','support','meeting')),
    status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK(status IN ('scheduled','completed','cancelled','rescheduled','no_show')),
    start_time      TEXT NOT NULL,
    end_time        TEXT NOT NULL,
    location        TEXT,
    meeting_link    TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_time);

-- Add token_expires_at to quotations if not already existing
-- (Safe in SQLite: we check PRAGMA or handle gracefully in migration)
