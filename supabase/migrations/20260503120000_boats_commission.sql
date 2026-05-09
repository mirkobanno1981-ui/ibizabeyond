-- Migration: Boat commissions (editor + platform) and multi-day package pricing
-- Editor-boat sets per-boat commission %; super-admin sets global platform fee (default 5%).
-- weekly_price stays for legacy quote compat; UI uses multi_day_package_price + threshold.

ALTER TABLE public.invenio_boats
    ADD COLUMN IF NOT EXISTS editor_commission_pct        NUMERIC(5,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS editor_commission_included   BOOLEAN      DEFAULT true,
    ADD COLUMN IF NOT EXISTS platform_commission_included BOOLEAN      DEFAULT true,
    ADD COLUMN IF NOT EXISTS multi_day_threshold_days     INTEGER      DEFAULT 7,
    ADD COLUMN IF NOT EXISTS multi_day_package_price      NUMERIC(12,2);

UPDATE public.invenio_boats
   SET multi_day_package_price = weekly_price
 WHERE multi_day_package_price IS NULL
   AND weekly_price IS NOT NULL;

ALTER TABLE public.global_settings
    ADD COLUMN IF NOT EXISTS boat_platform_commission_pct NUMERIC(5,2) DEFAULT 5;

UPDATE public.global_settings
   SET boat_platform_commission_pct = 5
 WHERE boat_platform_commission_pct IS NULL;
