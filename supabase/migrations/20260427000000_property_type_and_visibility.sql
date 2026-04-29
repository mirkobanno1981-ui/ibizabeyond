-- Property type (villa vs apartment) and per-user visibility overrides for villas + boats

ALTER TABLE invenio_properties
  ADD COLUMN IF NOT EXISTS property_type TEXT NOT NULL DEFAULT 'villa'
    CHECK (property_type IN ('villa','apartment'));

CREATE TABLE IF NOT EXISTS entity_visibility_overrides (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('villa','boat')),
  entity_id UUID NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, entity_type, entity_id)
);

ALTER TABLE entity_visibility_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_overrides" ON entity_visibility_overrides
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "super_admin_manage_overrides" ON entity_visibility_overrides
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

CREATE INDEX IF NOT EXISTS idx_evo_lookup ON entity_visibility_overrides(entity_type, entity_id);
