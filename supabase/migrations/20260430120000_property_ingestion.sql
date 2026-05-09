-- Multi-modal property ingestion: pgvector + ingestion jobs queue.
-- Adds embedding column to invenio_properties and a job table to track
-- LLM-driven extraction sessions (text/image/PDF/audio -> structured fields).

CREATE EXTENSION IF NOT EXISTS vector;

-- 768-dim Gemini embedding (gemini-embedding-001 with outputDimensionality=768).
ALTER TABLE invenio_properties
  ADD COLUMN IF NOT EXISTS embedding vector(768),
  ADD COLUMN IF NOT EXISTS embedding_text TEXT,
  ADD COLUMN IF NOT EXISTS ingestion_source TEXT DEFAULT 'manual'
    CHECK (ingestion_source IN ('manual','ai_multimodal')),
  ADD COLUMN IF NOT EXISTS ingestion_job_id UUID;

CREATE INDEX IF NOT EXISTS invenio_properties_embedding_hnsw_idx
  ON invenio_properties USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS property_ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','extracting','preview','committing','completed','failed')),
  raw_text TEXT,
  file_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  extracted JSONB,
  v_uuid UUID REFERENCES invenio_properties(v_uuid) ON DELETE SET NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_ingestion_jobs_user_id_idx
  ON property_ingestion_jobs(user_id);
CREATE INDEX IF NOT EXISTS property_ingestion_jobs_status_idx
  ON property_ingestion_jobs(status);

ALTER TABLE property_ingestion_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingestion_owner_rw ON property_ingestion_jobs;
CREATE POLICY ingestion_owner_rw ON property_ingestion_jobs
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_user(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_admin_user(auth.uid()));

-- Auto-update updated_at on row change.
CREATE OR REPLACE FUNCTION public.touch_property_ingestion_jobs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_property_ingestion_jobs ON property_ingestion_jobs;
CREATE TRIGGER trg_touch_property_ingestion_jobs
  BEFORE UPDATE ON property_ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_property_ingestion_jobs();

-- Storage bucket for transient ingestion uploads (created via Supabase Studio
-- or `supabase storage` CLI with public=false). RLS policies for storage
-- objects are managed in storage.objects below.
INSERT INTO storage.buckets (id, name, public)
VALUES ('villa-ingest-tmp', 'villa-ingest-tmp', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload to their own folder ({user_id}/...).
DROP POLICY IF EXISTS "ingest_tmp_user_insert" ON storage.objects;
CREATE POLICY "ingest_tmp_user_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'villa-ingest-tmp'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "ingest_tmp_user_read" ON storage.objects;
CREATE POLICY "ingest_tmp_user_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'villa-ingest-tmp'
    AND ((storage.foldername(name))[1] = auth.uid()::text
         OR public.is_admin_user(auth.uid()))
  );

DROP POLICY IF EXISTS "ingest_tmp_user_delete" ON storage.objects;
CREATE POLICY "ingest_tmp_user_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'villa-ingest-tmp'
    AND ((storage.foldername(name))[1] = auth.uid()::text
         OR public.is_admin_user(auth.uid()))
  );

-- Daily purge of transient bucket (>24h old). Requires pg_cron.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-villa-ingest-tmp')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-villa-ingest-tmp');
    PERFORM cron.schedule(
      'purge-villa-ingest-tmp',
      '0 3 * * *',
      $cron$
        DELETE FROM storage.objects
        WHERE bucket_id = 'villa-ingest-tmp'
          AND created_at < now() - interval '24 hours';
      $cron$
    );
  END IF;
END $$;
