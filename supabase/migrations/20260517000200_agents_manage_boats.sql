-- Extend boat management (toggle visibility / hard delete) to agent role.
-- Pairs with frontend canManageBoat extension in BoatsPage.jsx so DB does not
-- silently reject UPDATE/DELETE attempts from non-admin/non-owner agents.

DROP POLICY IF EXISTS "Agents can manage boats" ON public.boats;
CREATE POLICY "Agents can manage boats" ON public.boats
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role = 'agent'::user_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role = 'agent'::user_role
    )
  );

NOTIFY pgrst, 'reload schema';
