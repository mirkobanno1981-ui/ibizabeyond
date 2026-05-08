-- Boat columns referenced by BoatEditModal but missing in original schema.
-- Without these the manual save and AI commit silently failed.

ALTER TABLE invenio_boats
  ADD COLUMN IF NOT EXISTS tagline TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS cleaning_fee NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guest_capacity_overnight INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location_base_port VARCHAR(255),
  ADD COLUMN IF NOT EXISTS registration_number VARCHAR(255);
