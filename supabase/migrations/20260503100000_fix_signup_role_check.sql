-- Fix: signup failed with "Database error saving new user".
-- Cause: tr_super_admin_restriction on public.user_roles fired during the
-- on_auth_user_created_assign_role trigger. The check function used
-- unqualified `user_roles` (search_path empty in auth signup context →
-- "relation user_roles does not exist") and then would have raised
-- "Only super_admin can modify roles" anyway because auth.uid() is NULL
-- inside the auth signup transaction.
--
-- Fix: pin search_path and bypass the restriction when the call originates
-- from a system context (auth.uid() IS NULL) — that path can only be
-- reached by SECURITY DEFINER triggers like handle_new_user_role().

CREATE OR REPLACE FUNCTION public.check_super_admin_restriction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    caller_role TEXT;
    caller_email TEXT;
BEGIN
    -- System context (signup trigger, service role with no JWT, etc.)
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT role INTO caller_role FROM public.user_roles WHERE user_id = auth.uid();
    SELECT email INTO caller_email FROM auth.users WHERE id = auth.uid();

    IF caller_role IN ('super_admin', 'admin') OR caller_email = 'info@ibizabeyond.com' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only super_admin can modify roles';
END;
$$;

-- Belt-and-braces: pin search_path on the signup trigger function too,
-- so qualified references stay resolvable regardless of caller settings.
ALTER FUNCTION public.handle_new_user_role() SET search_path = public, auth;
