-- Unified quote money model: snapshot all € amounts on the quote at save time.
-- Stripe Connect Payment flow reads these fields directly — no runtime recalculation.
--
-- Replaces the previous patchwork of:
--   - editor_markup (% override) + editor_markup_mode ('add'|'deduct')
--   - stripe_fee_included / forex_fee_included toggles
--   - hardcoded 21% IVA divisor in stripe-checkout
--   - runtime profit split via agent.agency_split_pct or rental_type_configs
--
-- New rule: modal computes once, writes resolved € numbers, checkout trusts them.

ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS iva_percent          NUMERIC NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS extras_total_eur     NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS editor_share_eur     NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS editor_included      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS platform_profit_eur  NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS agency_profit_eur    NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS iva_amount_eur       NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS stripe_fee_eur       NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS upfront_stay_eur     NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN quotes.iva_percent          IS 'IVA % applied at save time (snapshot of margin_settings.iva_percent).';
COMMENT ON COLUMN quotes.extras_total_eur     IS 'Sum of extra_services prices in EUR.';
COMMENT ON COLUMN quotes.editor_share_eur     IS 'Capturer (editor) commission in EUR. Routed to editor stripe account at payout.';
COMMENT ON COLUMN quotes.editor_included      IS 'true: commission already inside supplier_base_price (deducted from owner). false: commission added on top of base (added to client price).';
COMMENT ON COLUMN quotes.platform_profit_eur  IS 'Platform share of margin in EUR. Lands on platform account via application_fee_amount.';
COMMENT ON COLUMN quotes.agency_profit_eur    IS 'Agency share of margin in EUR. Stays on agent connected account.';
COMMENT ON COLUMN quotes.iva_amount_eur       IS 'IVA amount in EUR. Routed to platform via application_fee_amount (platform invoices VAT).';
COMMENT ON COLUMN quotes.stripe_fee_eur       IS 'Stripe processing fee in EUR (3% of net amount). Charged to client, retained by agent to cover Stripe costs.';
COMMENT ON COLUMN quotes.upfront_stay_eur     IS 'Owner-side upfront cash flow at deposit time: full base if last-minute (<=42d), 50% otherwise.';

-- ----------------------------------------------------------------------------
-- Backfill existing quotes (best-effort: re-derives snapshot from legacy fields).
-- Quotes booked before this migration keep their final_price; only the breakdown
-- snapshot is regenerated so the Connect flow has data to read.
-- ----------------------------------------------------------------------------

-- Default iva_percent from margin_settings (typically 10%).
UPDATE quotes q
   SET iva_percent = COALESCE(m.iva_percent, 10)
  FROM margin_settings m
 WHERE m.id = 1
   AND q.iva_percent = 10;  -- only touch defaulted rows

-- Extras total from JSON.
UPDATE quotes
   SET extras_total_eur = COALESCE((
       SELECT SUM((elem->>'price')::NUMERIC)
         FROM jsonb_array_elements(extra_services::jsonb) AS elem
        WHERE (elem->>'price') IS NOT NULL
   ), 0)
 WHERE extras_total_eur = 0
   AND extra_services IS NOT NULL
   AND jsonb_typeof(extra_services::jsonb) = 'array';

-- Editor share + included flag from legacy editor_markup (%) + editor_markup_mode.
UPDATE quotes
   SET editor_share_eur = ROUND(COALESCE(supplier_base_price, 0) * COALESCE(editor_markup, 0) / 100.0, 2),
       editor_included  = (COALESCE(editor_markup_mode, 'deduct') = 'deduct')
 WHERE editor_share_eur = 0
   AND editor_markup IS NOT NULL
   AND editor_markup > 0;

-- IVA amount + profit split: derive from final_price - base - extras using IVA %.
-- agency vs platform split: use agent.agency_split_pct (default 67/33).
WITH derived AS (
    SELECT q.id,
           GREATEST(0, COALESCE(q.final_price, 0) - COALESCE(q.supplier_base_price, 0) - COALESCE(q.extras_total_eur, 0)) AS gross_margin,
           COALESCE(q.iva_percent, 10) AS iva_pct,
           COALESCE(a.agency_split_pct, 67) AS split_pct
      FROM quotes q
      LEFT JOIN agents a ON a.id = q.agent_id
     WHERE q.platform_profit_eur = 0
       AND q.agency_profit_eur = 0
       AND q.final_price IS NOT NULL
)
UPDATE quotes q
   SET iva_amount_eur      = ROUND(d.gross_margin * d.iva_pct / (100.0 + d.iva_pct), 2),
       agency_profit_eur   = ROUND((d.gross_margin - (d.gross_margin * d.iva_pct / (100.0 + d.iva_pct))) * d.split_pct / 100.0, 2),
       platform_profit_eur = ROUND((d.gross_margin - (d.gross_margin * d.iva_pct / (100.0 + d.iva_pct))) * (100.0 - d.split_pct) / 100.0, 2)
  FROM derived d
 WHERE q.id = d.id;

-- Stripe fee: 3% of net (legacy stripe_fee_included flag) — backfill for paid quotes only.
UPDATE quotes
   SET stripe_fee_eur = ROUND(COALESCE(final_price, 0) * 0.03, 2)
 WHERE stripe_fee_eur = 0
   AND COALESCE(stripe_fee_included, false) = true;

-- Upfront stay: 50% of base (or 100% if last-minute, <= 42 days from check_in to created_at).
UPDATE quotes
   SET upfront_stay_eur = CASE
       WHEN check_in IS NOT NULL AND created_at IS NOT NULL
            AND (check_in::date - created_at::date) <= 42
       THEN ROUND(COALESCE(supplier_base_price, 0), 2)
       ELSE ROUND(COALESCE(supplier_base_price, 0) * 0.5, 2)
   END
 WHERE upfront_stay_eur = 0
   AND supplier_base_price IS NOT NULL
   AND supplier_base_price > 0;

NOTIFY pgrst, 'reload schema';
