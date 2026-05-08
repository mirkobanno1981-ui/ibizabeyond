-- Drop the villa-only FK on invenio_seasonal_prices.v_uuid: the column is shared
-- between villas (invenio_properties) and boats (invenio_boats), and the FK was
-- silently rejecting every boat seasonal-rate insert.
ALTER TABLE invenio_seasonal_prices DROP CONSTRAINT IF EXISTS invenio_seasonal_prices_v_uuid_fkey;

-- Lock price feature: when true, public-quote agents cannot apply mark-up or
-- override the listing price; only admin/super_admin can.
ALTER TABLE invenio_boats ADD COLUMN IF NOT EXISTS price_locked boolean NOT NULL DEFAULT false;
