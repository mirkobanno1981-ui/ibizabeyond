-- Capturer (editor) commission rework: replaces single editor_markup_percent
-- with mode/amount/pct + "included in price" flag. Legacy column kept for
-- one release as deprecated read-only fallback.

ALTER TABLE invenio_properties
  ADD COLUMN IF NOT EXISTS capturer_commission_mode      TEXT    DEFAULT 'percent'
    CHECK (capturer_commission_mode IN ('percent','fixed')),
  ADD COLUMN IF NOT EXISTS capturer_commission_pct       NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS capturer_commission_amount    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS capturer_commission_included  BOOLEAN DEFAULT false;

UPDATE invenio_properties
   SET capturer_commission_mode    = 'percent',
       capturer_commission_pct     = COALESCE(editor_markup_percent, 0),
       capturer_commission_amount  = 0,
       capturer_commission_included = false
 WHERE editor_markup_percent IS NOT NULL
   AND (capturer_commission_pct IS NULL OR capturer_commission_pct = 0);
