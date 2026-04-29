-- Migration: Create villa_blocked_dates table for server-side iCal availability cache
-- Date: 2026-04-19
-- Purpose: Replace slow client-side iCal fetching with a fast indexed table,
--          populated periodically by the sync-ical edge function.

CREATE TABLE IF NOT EXISTS villa_blocked_dates (
    id           BIGSERIAL PRIMARY KEY,
    v_uuid       TEXT NOT NULL,
    start_date   DATE NOT NULL,
    end_date     DATE NOT NULL,
    summary      TEXT,
    synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT villa_blocked_dates_valid_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_villa_blocked_dates_v_uuid
    ON villa_blocked_dates (v_uuid);

CREATE INDEX IF NOT EXISTS idx_villa_blocked_dates_range
    ON villa_blocked_dates (v_uuid, start_date, end_date);

-- Track last successful sync per villa (for observability and stale detection).
CREATE TABLE IF NOT EXISTS villa_ical_sync_status (
    v_uuid        TEXT PRIMARY KEY,
    last_synced   TIMESTAMPTZ,
    last_error    TEXT,
    events_count  INTEGER DEFAULT 0
);

ALTER TABLE villa_blocked_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE villa_ical_sync_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "villa_blocked_dates_read_all" ON villa_blocked_dates;
CREATE POLICY "villa_blocked_dates_read_all"
    ON villa_blocked_dates FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "villa_ical_sync_status_read_all" ON villa_ical_sync_status;
CREATE POLICY "villa_ical_sync_status_read_all"
    ON villa_ical_sync_status FOR SELECT
    USING (true);
