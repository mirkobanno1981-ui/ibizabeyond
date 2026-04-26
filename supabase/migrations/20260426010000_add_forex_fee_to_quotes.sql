ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS forex_fee_included BOOLEAN DEFAULT false;
