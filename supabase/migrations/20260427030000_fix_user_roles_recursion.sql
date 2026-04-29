-- Fix infinite recursion on user_roles RLS policy.
-- Previous policy did: SELECT ... FROM user_roles WHERE ... — which retriggers the same policy.
-- Solution: SECURITY DEFINER helper bypasses RLS for the role lookup.

CREATE OR REPLACE FUNCTION public.is_admin_user(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = uid
          AND role IN ('admin', 'super_admin')
    )
    OR EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = uid AND email = 'info@ibizabeyond.com'
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_user(UUID) TO authenticated, anon;

-- Replace recursive policy on user_roles with non-recursive version
DROP POLICY IF EXISTS "admin_full_access_user_roles" ON user_roles;
CREATE POLICY "admin_full_access_user_roles" ON user_roles
    FOR ALL
    USING (public.is_admin_user(auth.uid()))
    WITH CHECK (public.is_admin_user(auth.uid()));

-- Also patch agents policy (same pattern, cleaner using helper)
DROP POLICY IF EXISTS "admin_full_access_agents" ON agents;
CREATE POLICY "admin_full_access_agents" ON agents
    FOR ALL
    USING (public.is_admin_user(auth.uid()))
    WITH CHECK (public.is_admin_user(auth.uid()));
