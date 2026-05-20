-- Geocoding support: indicative GPS for villas without precise coordinates.
-- Source-of-truth cascade: villa.gps → villa.indicative_gps → area.centroid_gps → city.centroid_gps.
-- A geocode_cache table avoids duplicate Google API calls on identical inputs.

-- =========================================================================
-- 1. Centroid columns on cities + areas
-- =========================================================================
ALTER TABLE public.cities
    ADD COLUMN IF NOT EXISTS centroid_gps        TEXT,
    ADD COLUMN IF NOT EXISTS geocode_confidence  TEXT,
    ADD COLUMN IF NOT EXISTS geocoded_at         TIMESTAMPTZ;

ALTER TABLE public.areas
    ADD COLUMN IF NOT EXISTS centroid_gps        TEXT,
    ADD COLUMN IF NOT EXISTS geocode_confidence  TEXT,
    ADD COLUMN IF NOT EXISTS geocoded_at         TIMESTAMPTZ;

-- =========================================================================
-- 2. Per-villa indicative GPS + provenance
-- =========================================================================
ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS indicative_gps         TEXT,
    ADD COLUMN IF NOT EXISTS indicative_gps_source  TEXT,
    ADD COLUMN IF NOT EXISTS geocoded_at            TIMESTAMPTZ;

-- =========================================================================
-- 3. Reusable cache keyed on normalized query string
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.geocode_cache (
    query_norm   TEXT PRIMARY KEY,
    lat          NUMERIC(9, 6) NOT NULL,
    lng          NUMERIC(9, 6) NOT NULL,
    confidence   TEXT,
    provider     TEXT,
    raw          JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "geocode_cache_authed_read" ON public.geocode_cache;
CREATE POLICY "geocode_cache_authed_read"
    ON public.geocode_cache FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin','editor','owner','agent')
        )
    );

-- Writes are reserved for the service role (used by the geocode-location Edge Function).
DROP POLICY IF EXISTS "geocode_cache_service_write" ON public.geocode_cache;
CREATE POLICY "geocode_cache_service_write"
    ON public.geocode_cache FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "geocode_cache_service_update" ON public.geocode_cache;
CREATE POLICY "geocode_cache_service_update"
    ON public.geocode_cache FOR UPDATE
    USING (auth.role() = 'service_role');
