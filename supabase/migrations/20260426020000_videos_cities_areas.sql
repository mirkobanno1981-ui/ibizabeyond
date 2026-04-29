-- Add video upload support + normalized cities/areas catalog.
-- Features stay denormalized (text[]) on invenio_properties; UI provides
-- autocomplete from distinct existing values. No schema change needed for features.

-- =========================================================================
-- 1. invenio_videos table (mirrors invenio_photos)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.invenio_videos (
    id BIGSERIAL PRIMARY KEY,
    v_uuid UUID NOT NULL REFERENCES invenio_properties(v_uuid) ON DELETE CASCADE,
    url TEXT NOT NULL,
    storage_path TEXT,
    caption TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_videos_v_uuid ON invenio_videos(v_uuid);

ALTER TABLE invenio_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "videos_public_read" ON invenio_videos;
CREATE POLICY "videos_public_read"
    ON invenio_videos FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "videos_admin_editor_write" ON invenio_videos;
CREATE POLICY "videos_admin_editor_write"
    ON invenio_videos FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin','editor','owner','agent')
        )
    );

DROP POLICY IF EXISTS "videos_admin_editor_update" ON invenio_videos;
CREATE POLICY "videos_admin_editor_update"
    ON invenio_videos FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin','editor','owner','agent')
        )
    );

DROP POLICY IF EXISTS "videos_admin_editor_delete" ON invenio_videos;
CREATE POLICY "videos_admin_editor_delete"
    ON invenio_videos FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin','editor','owner','agent')
        )
    );

-- =========================================================================
-- 2. villa-videos storage bucket + RLS
-- =========================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('villa-videos', 'villa-videos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "villa_videos_public_read" ON storage.objects;
CREATE POLICY "villa_videos_public_read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'villa-videos');

DROP POLICY IF EXISTS "villa_videos_admin_editor_write" ON storage.objects;
CREATE POLICY "villa_videos_admin_editor_write"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'villa-videos'
        AND EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin','editor','owner','agent')
        )
    );

DROP POLICY IF EXISTS "villa_videos_admin_editor_delete" ON storage.objects;
CREATE POLICY "villa_videos_admin_editor_delete"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'villa-videos'
        AND EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin','editor','owner','agent')
        )
    );

DROP POLICY IF EXISTS "villa_videos_admin_editor_update" ON storage.objects;
CREATE POLICY "villa_videos_admin_editor_update"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'villa-videos'
        AND EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin','editor','owner','agent')
        )
    );

-- =========================================================================
-- 3. cities + areas lookup tables
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.cities (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.areas (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    city_id BIGINT NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (city_id, name)
);

CREATE INDEX IF NOT EXISTS idx_areas_city_id ON areas(city_id);

ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cities_public_read" ON cities;
CREATE POLICY "cities_public_read"
    ON cities FOR SELECT USING (true);

DROP POLICY IF EXISTS "cities_authed_insert" ON cities;
CREATE POLICY "cities_authed_insert"
    ON cities FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin','editor','owner','agent')
        )
    );

DROP POLICY IF EXISTS "cities_admin_update" ON cities;
CREATE POLICY "cities_admin_update"
    ON cities FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin')
        )
    );

DROP POLICY IF EXISTS "cities_admin_delete" ON cities;
CREATE POLICY "cities_admin_delete"
    ON cities FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin')
        )
    );

DROP POLICY IF EXISTS "areas_public_read" ON areas;
CREATE POLICY "areas_public_read"
    ON areas FOR SELECT USING (true);

DROP POLICY IF EXISTS "areas_authed_insert" ON areas;
CREATE POLICY "areas_authed_insert"
    ON areas FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin','editor','owner','agent')
        )
    );

DROP POLICY IF EXISTS "areas_admin_update" ON areas;
CREATE POLICY "areas_admin_update"
    ON areas FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin')
        )
    );

DROP POLICY IF EXISTS "areas_admin_delete" ON areas;
CREATE POLICY "areas_admin_delete"
    ON areas FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('admin','super_admin')
        )
    );

-- =========================================================================
-- 4. FK columns on invenio_properties
-- =========================================================================
ALTER TABLE invenio_properties
    ADD COLUMN IF NOT EXISTS city_id BIGINT REFERENCES cities(id),
    ADD COLUMN IF NOT EXISTS area_id BIGINT REFERENCES areas(id);

CREATE INDEX IF NOT EXISTS idx_inv_props_city_id ON invenio_properties(city_id);
CREATE INDEX IF NOT EXISTS idx_inv_props_area_id ON invenio_properties(area_id);

-- =========================================================================
-- 5. Backfill: distinct district -> cities, distinct (district, areaname) -> areas
-- =========================================================================
INSERT INTO cities (name)
SELECT DISTINCT TRIM(district)
FROM invenio_properties
WHERE district IS NOT NULL AND TRIM(district) <> ''
ON CONFLICT (name) DO NOTHING;

INSERT INTO areas (name, city_id)
SELECT DISTINCT TRIM(p.areaname), c.id
FROM invenio_properties p
JOIN cities c ON c.name = TRIM(p.district)
WHERE p.areaname IS NOT NULL AND TRIM(p.areaname) <> ''
  AND p.district IS NOT NULL AND TRIM(p.district) <> ''
ON CONFLICT (city_id, name) DO NOTHING;

UPDATE invenio_properties p
SET city_id = c.id
FROM cities c
WHERE c.name = TRIM(p.district)
  AND p.city_id IS NULL
  AND p.district IS NOT NULL AND TRIM(p.district) <> '';

UPDATE invenio_properties p
SET area_id = a.id
FROM areas a
WHERE a.name = TRIM(p.areaname)
  AND a.city_id = p.city_id
  AND p.area_id IS NULL
  AND p.areaname IS NOT NULL AND TRIM(p.areaname) <> '';

-- Old text columns (district, areaname) intentionally retained for backward compatibility
-- with legacy code (e.g. Dashboard.jsx aggregations). Drop in a future migration.
