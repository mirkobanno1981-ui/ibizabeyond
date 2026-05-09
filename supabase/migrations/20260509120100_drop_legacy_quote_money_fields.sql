-- Drop legacy money fields after the snapshot migration
-- (20260509120000_unified_quote_money_snapshot.sql) has populated the new
-- columns and all consumers (EditQuoteModal, VillaView, BoatView, QuotesPage,
-- Dashboard, stripe-checkout) have been updated to read snapshot fields.
--
-- Run this migration only after verifying:
--   1. New quotes write the snapshot columns correctly.
--   2. Backfill ran on existing rows (snapshot fields non-zero where appropriate).
--   3. Stripe Connect Payment flow shows numbers consistent with the modal.
--
-- The columns dropped were:
--   - editor_markup_mode  ('add'|'deduct') → replaced by `editor_included` (boolean)
--   - stripe_fee_included (boolean toggle) → 3% always baked into final_price
--   - forex_fee_included  (boolean toggle) → unused, dropped (forex handled outside quote)

ALTER TABLE quotes
    DROP COLUMN IF EXISTS editor_markup_mode,
    DROP COLUMN IF EXISTS stripe_fee_included,
    DROP COLUMN IF EXISTS forex_fee_included;

NOTIFY pgrst, 'reload schema';
