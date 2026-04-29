-- Fix infinite recursion: managers_insert_owner_role policy had inline
-- SELECT on user_roles inside its own WITH CHECK, retriggering RLS on the
-- same table. Use SECURITY DEFINER helper instead.

DROP POLICY IF EXISTS "managers_insert_owner_role" ON public.user_roles;

CREATE POLICY "managers_insert_owner_role" ON public.user_roles
    FOR INSERT
    TO authenticated
    WITH CHECK (
        role = 'owner'::user_role
        AND public.is_admin_user(auth.uid())
    );
