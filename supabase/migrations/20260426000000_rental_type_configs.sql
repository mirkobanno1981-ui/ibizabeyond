-- Add rental type configuration per villa and rental type per quote
ALTER TABLE invenio_properties
  ADD COLUMN IF NOT EXISTS rental_type_configs JSONB DEFAULT '{}';

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS rental_type TEXT DEFAULT 'daily';
