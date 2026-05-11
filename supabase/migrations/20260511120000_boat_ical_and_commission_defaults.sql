-- Boats: ical_url, captator commission columns, global platform pct, blocked_dates tables.
-- Reapplies columns from skipped 20260503120000_boats_commission.sql.

ALTER TABLE public.boats
    ADD COLUMN IF NOT EXISTS ical_url                     TEXT,
    ADD COLUMN IF NOT EXISTS editor_commission_pct        NUMERIC(5,2) DEFAULT 5,
    ADD COLUMN IF NOT EXISTS editor_commission_included   BOOLEAN      DEFAULT true,
    ADD COLUMN IF NOT EXISTS platform_commission_included BOOLEAN      DEFAULT true,
    ADD COLUMN IF NOT EXISTS multi_day_threshold_days     INTEGER      DEFAULT 7,
    ADD COLUMN IF NOT EXISTS multi_day_package_price      NUMERIC(12,2);

UPDATE public.boats
   SET multi_day_package_price = weekly_price
 WHERE multi_day_package_price IS NULL
   AND weekly_price IS NOT NULL;

ALTER TABLE public.boats
    ALTER COLUMN editor_commission_pct SET DEFAULT 5;

UPDATE public.boats
   SET editor_commission_pct = 5
 WHERE editor_commission_pct IS NULL
    OR editor_commission_pct < 5;

ALTER TABLE public.global_settings
    ADD COLUMN IF NOT EXISTS boat_platform_commission_pct NUMERIC(5,2) DEFAULT 5;

UPDATE public.global_settings
   SET boat_platform_commission_pct = 5
 WHERE boat_platform_commission_pct IS NULL;

CREATE TABLE IF NOT EXISTS boat_blocked_dates (
    id           BIGSERIAL PRIMARY KEY,
    v_uuid       TEXT NOT NULL,
    start_date   DATE NOT NULL,
    end_date     DATE NOT NULL,
    summary      TEXT,
    synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT boat_blocked_dates_valid_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_boat_blocked_dates_v_uuid
    ON boat_blocked_dates (v_uuid);

CREATE INDEX IF NOT EXISTS idx_boat_blocked_dates_range
    ON boat_blocked_dates (v_uuid, start_date, end_date);

CREATE TABLE IF NOT EXISTS boat_ical_sync_status (
    v_uuid        TEXT PRIMARY KEY,
    last_synced   TIMESTAMPTZ,
    last_error    TEXT,
    events_count  INTEGER DEFAULT 0
);

ALTER TABLE boat_blocked_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE boat_ical_sync_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "boat_blocked_dates_read_all" ON boat_blocked_dates;
CREATE POLICY "boat_blocked_dates_read_all"
    ON boat_blocked_dates FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "boat_ical_sync_status_read_all" ON boat_ical_sync_status;
CREATE POLICY "boat_ical_sync_status_read_all"
    ON boat_ical_sync_status FOR SELECT
    USING (true);

NOTIFY pgrst, 'reload schema';
