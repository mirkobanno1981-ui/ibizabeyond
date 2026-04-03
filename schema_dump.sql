-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
CREATE TYPE agent_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE agent_type AS ENUM ('individual', 'collaborator', 'agency', 'sub_agent', 'agency_admin');
CREATE TYPE boat_type AS ENUM ('Motor', 'Sail', 'Catamaran', 'Superyacht');
CREATE TYPE fuel_policy AS ENUM ('Full-to-Full', 'APA', 'Included');
CREATE TYPE quote_status AS ENUM ('draft', 'sent', 'booked', 'cancelled', 'check_in_ready', 'completed', 'expired', 'waiting_owner', 'owner_declined', 'details_requested', 'contract_sent', 'contract_signed');
CREATE TYPE skipper_type AS ENUM ('Included', 'Optional', 'Bareboat');
CREATE TYPE user_role AS ENUM ('admin', 'agent', 'editor', 'owner', 'super_admin');

-- Functions
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.agent_roles (user_id, role)
  VALUES (NEW.id, 'agent');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION handle_new_user_role()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'agent');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_admin_margin_from_margin_settings()
RETURNS trigger AS $$
BEGIN
  UPDATE margin_settings 
  SET admin_margin = (SELECT margin FROM global_settings LIMIT 1)
  WHERE is_admin = true;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_super_admin_restriction()
RETURNS trigger AS $$
BEGIN
  IF (SELECT role FROM user_roles WHERE user_id = auth.uid()) != 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can modify roles';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tables (Public Schema) --
-- Note: Order is important for FKs --

CREATE TABLE owners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id), -- This assumes auth.users exists
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    agency_name TEXT,
    status agent_status DEFAULT 'pending',
    type agent_type DEFAULT 'individual',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invenio_properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES owners(id),
    name TEXT NOT NULL,
    description TEXT,
    location TEXT,
    bedrooms INTEGER,
    bathrooms INTEGER,
    max_guests INTEGER,
    base_price NUMERIC,
    amenities TEXT[],
    images TEXT[],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invenio_boats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES owners(id),
    name TEXT NOT NULL,
    model TEXT,
    length NUMERIC,
    capacity INTEGER,
    cabins INTEGER,
    type boat_type,
    skipper skipper_type,
    fuel fuel_policy,
    price_low NUMERIC,
    price_high NUMERIC,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invenio_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID REFERENCES invenio_properties(id) ON DELETE CASCADE,
    boat_id UUID REFERENCES invenio_boats(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    "order" INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invenio_seasonal_prices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID REFERENCES invenio_properties(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    price NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id),
    client_id UUID REFERENCES clients(id),
    property_id UUID REFERENCES invenio_properties(id),
    boat_id UUID REFERENCES invenio_boats(id),
    status quote_status DEFAULT 'draft',
    check_in DATE,
    check_out DATE,
    total_amount NUMERIC,
    deposit_amount NUMERIC,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'agent',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE guests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    passport_number TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
    sender_id UUID,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE global_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    margin NUMERIC DEFAULT 0.20,
    iva NUMERIC DEFAULT 0.21,
    company_name TEXT,
    company_email TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE margin_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    is_admin BOOLEAN DEFAULT false,
    admin_margin NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Triggers
CREATE TRIGGER on_auth_user_created_assign_role
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION handle_new_user_role();

CREATE TRIGGER update_invenio_boats_updated_at
BEFORE UPDATE ON invenio_boats
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER margin_settings_sync_trigger
AFTER INSERT OR UPDATE ON margin_settings
FOR EACH ROW EXECUTE FUNCTION sync_admin_margin_from_margin_settings();

CREATE TRIGGER tr_super_admin_restriction
BEFORE UPDATE OR DELETE ON user_roles
FOR EACH ROW EXECUTE FUNCTION check_super_admin_restriction();
