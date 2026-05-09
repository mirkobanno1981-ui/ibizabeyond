-- Migration: Services catalog (super_admin managed)

-- Add services_enabled to global_settings
ALTER TABLE public.global_settings
    ADD COLUMN IF NOT EXISTS services_enabled BOOLEAN DEFAULT true;

-- Service categories (extensible by super_admin)
CREATE TABLE IF NOT EXISTS public.service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    icon VARCHAR(50) DEFAULT 'concierge',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default categories
INSERT INTO public.service_categories (name, icon, sort_order) VALUES
    ('Hairdresser', 'content_cut', 10),
    ('Barber', 'face_retouching_natural', 20),
    ('Massage', 'spa', 30),
    ('Personal Chef', 'restaurant', 40),
    ('Personal Trainer', 'fitness_center', 50),
    ('Babysitter', 'child_care', 60),
    ('Photographer', 'photo_camera', 70),
    ('Other', 'concierge', 999)
ON CONFLICT (name) DO NOTHING;

-- Services table
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    category_id UUID REFERENCES public.service_categories(id) ON DELETE SET NULL,
    provider VARCHAR(255),
    description TEXT,
    price NUMERIC(12,2),
    currency VARCHAR(10) DEFAULT 'EUR',
    price_unit VARCHAR(50) DEFAULT 'session',
    photo_url TEXT,
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    contact_website TEXT,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_services_category ON public.services(category_id);
CREATE INDEX IF NOT EXISTS idx_services_active ON public.services(is_active);

-- RLS
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- Categories: any authenticated user can read; super_admin writes
DROP POLICY IF EXISTS "Authenticated read categories" ON public.service_categories;
CREATE POLICY "Authenticated read categories" ON public.service_categories
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Super admin manages categories" ON public.service_categories;
CREATE POLICY "Super admin manages categories" ON public.service_categories
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin'));

-- Services: any authenticated user reads active; super_admin writes
DROP POLICY IF EXISTS "Authenticated read active services" ON public.services;
CREATE POLICY "Authenticated read active services" ON public.services
    FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "Super admin reads all services" ON public.services;
CREATE POLICY "Super admin reads all services" ON public.services
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin'));

DROP POLICY IF EXISTS "Super admin manages services" ON public.services;
CREATE POLICY "Super admin manages services" ON public.services
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin'));

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_services_updated_at ON public.services;
CREATE TRIGGER trg_services_updated_at
    BEFORE UPDATE ON public.services
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();
