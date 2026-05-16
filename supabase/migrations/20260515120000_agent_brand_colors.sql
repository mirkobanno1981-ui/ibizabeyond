-- Per-agent brand colors used to theme client-facing quote views and the agent's own dashboard.
ALTER TABLE public.agents
    ADD COLUMN IF NOT EXISTS brand_primary_color text,
    ADD COLUMN IF NOT EXISTS brand_accent_color text;

ALTER TABLE public.agents
    ADD CONSTRAINT agents_brand_primary_color_hex_chk
        CHECK (brand_primary_color IS NULL OR brand_primary_color ~* '^#[0-9a-f]{6}$') NOT VALID;

ALTER TABLE public.agents
    ADD CONSTRAINT agents_brand_accent_color_hex_chk
        CHECK (brand_accent_color IS NULL OR brand_accent_color ~* '^#[0-9a-f]{6}$') NOT VALID;
