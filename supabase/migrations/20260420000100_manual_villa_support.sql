-- Manual villa entry system
-- 1. Source marker on invenio_properties: distinguish API-synced vs manually created villas
ALTER TABLE invenio_properties
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'api'
  CHECK (source IN ('api','manual'));

CREATE INDEX IF NOT EXISTS idx_inv_props_source ON invenio_properties(source);

-- 2. Photos table: caption + storage_path for bucket-backed deletion
ALTER TABLE invenio_photos
  ADD COLUMN IF NOT EXISTS caption TEXT,
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- 3. Public bucket for manually uploaded villa photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('villa-photos', 'villa-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage RLS
DROP POLICY IF EXISTS "villa_photos_public_read" ON storage.objects;
CREATE POLICY "villa_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'villa-photos');

DROP POLICY IF EXISTS "villa_photos_admin_editor_write" ON storage.objects;
CREATE POLICY "villa_photos_admin_editor_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'villa-photos'
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin','super_admin','editor','owner','agent')
    )
  );

DROP POLICY IF EXISTS "villa_photos_admin_editor_delete" ON storage.objects;
CREATE POLICY "villa_photos_admin_editor_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'villa-photos'
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin','super_admin','editor','owner','agent')
    )
  );

DROP POLICY IF EXISTS "villa_photos_admin_editor_update" ON storage.objects;
CREATE POLICY "villa_photos_admin_editor_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'villa-photos'
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin','super_admin','editor','owner','agent')
    )
  );
