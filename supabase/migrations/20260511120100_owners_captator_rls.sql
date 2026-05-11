-- Captator agents: allow agents to create + manage their own owners.
-- An owner.agent_id equals the agents.id of the captator who recruited them.

CREATE OR REPLACE FUNCTION public.current_agent_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    -- agents.id IS the auth user uuid (no separate user_id column).
    SELECT id FROM agents WHERE id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_agent_id() TO authenticated;

ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_select_own_owners" ON public.owners;
CREATE POLICY "agents_select_own_owners" ON public.owners
    FOR SELECT
    TO authenticated
    USING (
        agent_id = public.current_agent_id()
        OR public.is_admin_user(auth.uid())
    );

DROP POLICY IF EXISTS "agents_insert_own_owners" ON public.owners;
CREATE POLICY "agents_insert_own_owners" ON public.owners
    FOR INSERT
    TO authenticated
    WITH CHECK (
        agent_id = public.current_agent_id()
        OR public.is_admin_user(auth.uid())
    );

DROP POLICY IF EXISTS "agents_update_own_owners" ON public.owners;
CREATE POLICY "agents_update_own_owners" ON public.owners
    FOR UPDATE
    TO authenticated
    USING (
        agent_id = public.current_agent_id()
        OR public.is_admin_user(auth.uid())
    )
    WITH CHECK (
        agent_id = public.current_agent_id()
        OR public.is_admin_user(auth.uid())
    );

NOTIFY pgrst, 'reload schema';
