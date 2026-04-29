-- Migration: Schedule hourly iCal sync via pg_cron + pg_net
-- Date: 2026-04-19
-- Requires extensions: pg_cron, pg_net (enable in Supabase dashboard: Database > Extensions)
--
-- Before running this migration, set the Vault secrets used below:
--   select vault.create_secret('<PROJECT_REF>.supabase.co', 'project_host');
--   select vault.create_secret('<SERVICE_ROLE_KEY>',         'service_role_key');
-- Re-run this migration (or manually run the cron.schedule call) after secrets exist.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any previous schedule with the same name (idempotent).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-ical-hourly') THEN
        PERFORM cron.unschedule('sync-ical-hourly');
    END IF;
END $$;

-- Schedule: every hour at minute 5
SELECT cron.schedule(
    'sync-ical-hourly',
    '5 * * * *',
    $cron$
    SELECT net.http_post(
        url := 'https://' ||
               (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_host') ||
               '/functions/v1/sync-ical',
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' ||
                (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
    $cron$
);
