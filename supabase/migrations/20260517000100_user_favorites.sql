-- Per-user favorites for villas, boats, services. Same pattern as entity_visibility_overrides.

CREATE TABLE IF NOT EXISTS public.user_favorites (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('villa','boat','service')),
  entity_id   UUID NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, entity_type, entity_id)
);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_favorites" ON public.user_favorites;
CREATE POLICY "users_manage_own_favorites" ON public.user_favorites
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_favorites_user_type ON public.user_favorites(user_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_favorites_entity   ON public.user_favorites(entity_type, entity_id);

NOTIFY pgrst, 'reload schema';
