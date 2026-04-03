-- Migration: Create Boat Charter Inventory
CREATE TYPE boat_type AS ENUM ('Motor', 'Sail', 'Catamaran', 'Superyacht');
CREATE TYPE skipper_type AS ENUM ('Included', 'Optional', 'Bareboat');
CREATE TYPE fuel_policy AS ENUM ('Full-to-Full', 'APA', 'Included');

CREATE TABLE IF NOT EXISTS invenio_boats (
    v_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boat_name VARCHAR(255) NOT NULL,
    manufacturer VARCHAR(255),
    model VARCHAR(255),
    year INTEGER,
    type boat_type DEFAULT 'Motor',
    length_ft NUMERIC(10,2),
    beam_ft NUMERIC(10,2),
    draft_ft NUMERIC(10,2),
    cabins INTEGER DEFAULT 0,
    bathrooms NUMERIC(3,1) DEFAULT 0,
    sleeps INTEGER DEFAULT 0,
    guest_capacity_day INTEGER DEFAULT 12,
    base_port VARCHAR(255),
    skipper_type skipper_type DEFAULT 'Included',
    fuel_policy fuel_policy DEFAULT 'Full-to-Full',
    features JSONB DEFAULT '[]',
    description TEXT,
    daily_price NUMERIC(12,2),
    weekly_price NUMERIC(12,2),
    security_deposit NUMERIC(12,2),
    owner_id UUID REFERENCES auth.users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE invenio_boats ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Public read active boats" ON invenio_boats
    FOR SELECT USING (is_active = true);

CREATE POLICY "Owners can manage their boats" ON invenio_boats
    FOR ALL USING (auth.uid() = owner_id);

CREATE POLICY "Admins can manage all boats" ON invenio_boats
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles 
            WHERE user_id = auth.uid() 
            AND role IN ('admin', 'super_admin')
        )
    );

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

    EXECUTE PROCEDURE update_updated_at_column();

-- Add Boat link to Quotes
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS boat_uuid UUID REFERENCES public.invenio_boats(v_uuid);

-- Add Boat link to Photos
ALTER TABLE public.invenio_photos ADD COLUMN IF NOT EXISTS boat_uuid UUID REFERENCES public.invenio_boats(v_uuid);
-- Modify the FK to be optional if needed (it already is nullable)
