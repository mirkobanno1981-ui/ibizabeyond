-- Phase 2: per-owner automatic Stripe split toggle + per-villa editor commission

ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS split_enabled BOOLEAN DEFAULT false;

ALTER TABLE invenio_properties
  ADD COLUMN IF NOT EXISTS editor_markup_percent NUMERIC DEFAULT 0;
