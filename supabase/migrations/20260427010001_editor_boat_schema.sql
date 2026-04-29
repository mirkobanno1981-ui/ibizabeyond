-- editor-boat: own-row tracking on invenio_boats + RLS policy

ALTER TABLE invenio_boats
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS editor_markup_percent NUMERIC DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inv_boats_created_by ON invenio_boats(created_by);

-- owner_id is nullable already; editor-boat will set created_by but not owner_id

DROP POLICY IF EXISTS "editor_boat_manage_own" ON invenio_boats;
CREATE POLICY "editor_boat_manage_own" ON invenio_boats
  FOR ALL USING (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'editor-boat')
  ) WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'editor-boat')
  );
