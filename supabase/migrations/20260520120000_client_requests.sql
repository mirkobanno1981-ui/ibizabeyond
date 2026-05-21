-- Client Requests: inbound unstructured rental requests parsed by AI into structured criteria.
-- Shared pool: all authenticated users can read/write (per product spec). Tighten if per-agent
-- assignment is added later; the broad policy here is intentional and signposted.

CREATE TABLE IF NOT EXISTS client_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  raw_text      TEXT NOT NULL,
  parsed        JSONB,
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','parsed','matched','quoted','closed')),
  notes         TEXT,
  ai_confidence NUMERIC
);

CREATE INDEX IF NOT EXISTS client_requests_status_idx     ON client_requests(status);
CREATE INDEX IF NOT EXISTS client_requests_created_at_idx ON client_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS client_requests_created_by_idx ON client_requests(created_by);

ALTER TABLE client_requests ENABLE ROW LEVEL SECURITY;

-- Intentional shared-pool policy. If per-agent assignment is added later, replace this.
DROP POLICY IF EXISTS client_requests_all_auth ON client_requests;
CREATE POLICY client_requests_all_auth ON client_requests
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.touch_client_requests()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_client_requests ON client_requests;
CREATE TRIGGER trg_touch_client_requests
  BEFORE UPDATE ON client_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_client_requests();

-- Link quotes back to their originating request.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES client_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quotes_request_id_idx ON quotes(request_id);
