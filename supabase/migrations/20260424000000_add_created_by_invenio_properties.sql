-- Editor-scoped villa ownership: track which user created a manually-added villa
-- Frontend filters editor villas via (owner_id IN managed_owners) OR (created_by = uid)

ALTER TABLE invenio_properties
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inv_props_created_by ON invenio_properties(created_by);
