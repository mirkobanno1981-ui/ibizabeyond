-- Per-quote editor (captatore) markup override.
-- Super admin can specify a custom editor commission per quote, overriding villa default.
-- Mode controls whether the markup adds to the client price or is deducted from owner payout.

ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS editor_markup NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS editor_markup_mode TEXT NOT NULL DEFAULT 'deduct'
    CHECK (editor_markup_mode IN ('add', 'deduct'));
