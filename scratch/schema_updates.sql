-- 1. Add agent_id to owners table to track direct contacts for agents
ALTER TABLE public.owners ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id);

-- 2. Add created_by to properties and boats to track who inserted the record
ALTER TABLE public.invenio_properties ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE public.invenio_boats ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- 3. Enable RLS updates (Instructions for the user)
-- Since RLS policies are complex and depend on existing names, I recommend clicking 'Enable RLS' 
-- and adding these policies in the Supabase Dashboard:

/*
-- Policy for owners: Agents can see their own contacts
CREATE POLICY "Agents can manage their own owners" ON public.owners
FOR ALL USING (
  auth.uid() = id OR 
  agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin'))
);

-- Policy for properties: Agents can see properties from their owners
CREATE POLICY "Agents can view managed properties" ON public.invenio_properties
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.owners 
    WHERE id = invenio_properties.owner_id 
    AND agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  ) OR
  created_by = auth.uid() OR
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin'))
);
*/

-- 4. Initial sync: If existing properties have an owner_id, we keep it. 
-- New properties created by agents will now store their user.id in created_by.
