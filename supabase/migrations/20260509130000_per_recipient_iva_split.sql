-- Per-recipient IVA: editor, selling agency, and platform each invoice IVA
-- on their own commission portion. The lump iva_amount_eur stays as the sum.
ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS editor_iva_eur   NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS agency_iva_eur   NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS platform_iva_eur NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN quotes.editor_iva_eur   IS 'IVA on editor (capturer) commission. Routed to editor connected account on top of editor_share_eur.';
COMMENT ON COLUMN quotes.agency_iva_eur   IS 'IVA on selling agency commission + extras. Retained on agent connected account.';
COMMENT ON COLUMN quotes.platform_iva_eur IS 'IVA on platform commission. Routed to platform via application_fee_amount.';

-- Backfill: distribute existing iva_amount_eur proportionally to each recipient.
WITH bases AS (
    SELECT id,
           CASE WHEN editor_included THEN 0 ELSE editor_share_eur END AS editor_iva_base,
           agency_profit_eur + extras_total_eur AS agency_iva_base,
           platform_profit_eur AS platform_iva_base,
           iva_amount_eur AS iva_total
      FROM quotes
)
UPDATE quotes q
   SET editor_iva_eur   = ROUND(b.editor_iva_base   * COALESCE(q.iva_percent, 10) / 100.0, 2),
       agency_iva_eur   = ROUND(b.agency_iva_base   * COALESCE(q.iva_percent, 10) / 100.0, 2),
       platform_iva_eur = ROUND(b.platform_iva_base * COALESCE(q.iva_percent, 10) / 100.0, 2)
  FROM bases b
 WHERE q.id = b.id;

NOTIFY pgrst, 'reload schema';
