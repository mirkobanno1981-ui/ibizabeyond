-- Allow invenio_properties.owner_id to reference ANY auth.users.id (not just owners.id).
-- Drop any FK pointing at owners table; keep/add FK to auth.users(id) ON DELETE SET NULL.
-- Background: super_admin needs to assign villas to editor users (captatori) who do not
-- have an entry in the `owners` lookup table — a FK to owners would block that.

DO $$
DECLARE
    fk_name TEXT;
BEGIN
    -- Drop every FK on invenio_properties.owner_id (regardless of which table it targets)
    FOR fk_name IN
        SELECT conname
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.invenio_properties'::regclass
          AND c.contype = 'f'
          AND a.attname = 'owner_id'
    LOOP
        EXECUTE format('ALTER TABLE public.invenio_properties DROP CONSTRAINT %I', fk_name);
        RAISE NOTICE 'Dropped FK %', fk_name;
    END LOOP;
END $$;

-- Recreate FK to auth.users(id). SET NULL on user delete so the villa survives.
ALTER TABLE public.invenio_properties
    ADD CONSTRAINT invenio_properties_owner_id_users_fkey
    FOREIGN KEY (owner_id)
    REFERENCES auth.users(id)
    ON DELETE SET NULL;
