-- Boat ingestion: AI multimodal extraction parallel to property-ingest.

ALTER TABLE invenio_boats
  ADD COLUMN IF NOT EXISTS ingestion_source TEXT DEFAULT 'manual'
    CHECK (ingestion_source IN ('manual','ai_multimodal')),
  ADD COLUMN IF NOT EXISTS ingestion_job_id UUID,
  ADD COLUMN IF NOT EXISTS marketing_sources JSONB;

CREATE TABLE IF NOT EXISTS boat_ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','extracting','preview','committing','completed','failed')),
  raw_text TEXT,
  file_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  extracted JSONB,
  grounding_sources JSONB,
  boat_uuid UUID REFERENCES invenio_boats(v_uuid) ON DELETE SET NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS boat_ingestion_jobs_user_id_idx
  ON boat_ingestion_jobs(user_id);
CREATE INDEX IF NOT EXISTS boat_ingestion_jobs_status_idx
  ON boat_ingestion_jobs(status);

ALTER TABLE boat_ingestion_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boat_ingest_owner_rw ON boat_ingestion_jobs;
CREATE POLICY boat_ingest_owner_rw ON boat_ingestion_jobs
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_user(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_admin_user(auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_boat_ingestion_jobs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_boat_ingestion_jobs ON boat_ingestion_jobs;
CREATE TRIGGER trg_touch_boat_ingestion_jobs
  BEFORE UPDATE ON boat_ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_boat_ingestion_jobs();

-- Public boat-photos bucket (mirrors villa-photos).
INSERT INTO storage.buckets (id, name, public)
VALUES ('boat-photos', 'boat-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "boat_photos_public_read" ON storage.objects;
CREATE POLICY "boat_photos_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'boat-photos');

DROP POLICY IF EXISTS "boat_photos_authenticated_write" ON storage.objects;
CREATE POLICY "boat_photos_authenticated_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'boat-photos');

DROP POLICY IF EXISTS "boat_photos_authenticated_update" ON storage.objects;
CREATE POLICY "boat_photos_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'boat-photos');

DROP POLICY IF EXISTS "boat_photos_authenticated_delete" ON storage.objects;
CREATE POLICY "boat_photos_authenticated_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'boat-photos');
