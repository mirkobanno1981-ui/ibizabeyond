-- Fix admin/super_admin save permissions for agents + user_roles
-- Bug: super_admin (mapped via email override) couldn't save agent/role changes
-- because trigger checks user_roles.role from DB and finds 'admin' (downgraded)

-- 1. Trigger now accepts both admin and super_admin
CREATE OR REPLACE FUNCTION check_super_admin_restriction()
RETURNS trigger AS $$
DECLARE
    caller_role TEXT;
    caller_email TEXT;
BEGIN
    SELECT role INTO caller_role FROM user_roles WHERE user_id = auth.uid();
    SELECT email INTO caller_email FROM auth.users WHERE id = auth.uid();

    IF caller_role IN ('super_admin', 'admin') OR caller_email = 'info@ibizabeyond.com' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only super_admin can modify roles';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. RLS on agents: super_admin/admin can update any row
DROP POLICY IF EXISTS "admin_full_access_agents" ON agents;
CREATE POLICY "admin_full_access_agents" ON agents
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('admin', 'super_admin')
        )
        OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'info@ibizabeyond.com'
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('admin', 'super_admin')
        )
        OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'info@ibizabeyond.com'
    );

-- 3. RLS on user_roles: super_admin/admin can manage any row
DROP POLICY IF EXISTS "admin_full_access_user_roles" ON user_roles;
CREATE POLICY "admin_full_access_user_roles" ON user_roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur2
            WHERE ur2.user_id = auth.uid()
              AND ur2.role IN ('admin', 'super_admin')
        )
        OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'info@ibizabeyond.com'
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur2
            WHERE ur2.user_id = auth.uid()
              AND ur2.role IN ('admin', 'super_admin')
        )
        OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'info@ibizabeyond.com'
    );
