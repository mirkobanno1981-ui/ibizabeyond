-- File: fix_user_roles_recursion.sql
-- Esegui questo script nel SQL Editor di Supabase per risolvere l'errore di ricorsione infinita.

-- 1. Creiamo una funzione "Security Definer" per controllare se l'utente è admin.
-- Questa funzione gira con i permessi del creatore (postgres) e quindi NON attiva le policy RLS al suo interno,
-- rompendo la catena di ricorsione.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Rimuoviamo le vecchie policy che causano ricorsione su user_roles (se i nomi sono standard).
-- Se hai nomi diversi, dovrai adattare i DROP POLICY.
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update user_roles" ON public.user_roles;

-- 3. Creiamo le nuove policy per user_roles usando la funzione is_admin()
CREATE POLICY "Admins can manage all roles" ON public.user_roles
FOR ALL
TO authenticated
USING (is_admin());

CREATE POLICY "Users can view their own roles" ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR is_admin());

-- 4. Assicuriamoci che anche la tabella agents non abbia ricorsione
DROP POLICY IF EXISTS "Admins can manage agents" ON public.agents;
CREATE POLICY "Admins can manage agents" ON public.agents
FOR ALL
TO authenticated
USING (is_admin());

DROP POLICY IF EXISTS "Agents can view their own profile" ON public.agents;
CREATE POLICY "Agents can view their own profile" ON public.agents
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR is_admin());
