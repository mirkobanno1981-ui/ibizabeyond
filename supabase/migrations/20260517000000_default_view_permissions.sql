-- Grant default view permissions on villa/boat/service/apartment categories to all users.
-- Fixes: villas approved (is_active=true) were filtered out client-side for users without
-- per-category view permissions in user_category_permissions.
-- Add column adds get gated separately (no default add permission granted here).

-- 1. Backfill: for every existing auth user × base category, insert can_view=true if missing.
INSERT INTO public.user_category_permissions (user_id, category, can_view, can_add, updated_at)
SELECT u.id, cat, true, false, now()
FROM auth.users u
CROSS JOIN (VALUES ('villa_licensed'), ('villa_unlicensed'), ('apartment'), ('boat'), ('service')) AS c(cat)
ON CONFLICT (user_id, category) DO UPDATE
  SET can_view = true,
      updated_at = now()
  WHERE public.user_category_permissions.can_view IS DISTINCT FROM true;

-- 2. Trigger: new auth users automatically get can_view=true on base categories.
CREATE OR REPLACE FUNCTION public.grant_default_view_permissions()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_category_permissions (user_id, category, can_view, can_add, updated_at)
  VALUES
    (NEW.id, 'villa_licensed',   true, false, now()),
    (NEW.id, 'villa_unlicensed', true, false, now()),
    (NEW.id, 'apartment',        true, false, now()),
    (NEW.id, 'boat',             true, false, now()),
    (NEW.id, 'service',          true, false, now())
  ON CONFLICT (user_id, category) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_default_view_permissions ON auth.users;
CREATE TRIGGER trg_default_view_permissions
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.grant_default_view_permissions();

NOTIFY pgrst, 'reload schema';
