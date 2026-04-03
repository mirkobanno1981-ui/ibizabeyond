-- data_dump.sql

-- 1. auth.users
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token, email_change_token_current, email_change_confirm_status, banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous)
VALUES 
('73206680-77a8-4444-a006-258800185984', 'authenticated', 'authenticated', 'admin@ibizabeyond.com', '$2a$10$O0K6z7BOCa.p0R.H.p0UBeH2.pM.pM.pM.pM.pM.pM.pM.pM.pM.pM', '2024-03-20 10:00:00+00', NULL, '2026-04-02 15:00:00+00', '{"provider": "email", "providers": ["email"]}', '{"full_name": "Admin"}', '2024-03-20 10:00:00+00', '2026-04-02 15:00:00+00', '', '', '', '', '', 0, NULL, '', NULL, false, NULL, false),
('1729b20b-9366-48ec-960c-2592506e7552', 'authenticated', 'authenticated', 'agent1@example.com', '$2a$10$p0M.pM.pM.pM.pM.pM.pM.pM.pM.pM.pM.pM.pM.pM.pM.pM.pM.pM.pM.pM', '2024-03-21 12:00:00+00', NULL, '2026-04-01 10:00:00+00', '{"provider": "email", "providers": ["email"]}', '{"full_name": "Agent One"}', '2024-03-21 12:00:00+00', '2026-04-01 10:00:00+00', '', '', '', '', '', 0, NULL, '', NULL, false, NULL, false)
ON CONFLICT (id) DO NOTHING;

-- 2. owners
INSERT INTO public.owners (id, name, email, phone, notes, created_at)
VALUES 
('2578b973-aa9b-4774-98da-4afd4edaf60d', 'Invenio', 'edoardo@inveniohomes.com', '+34 633 08 85 38', NULL, '2026-03-21 16:23:13.747759+00')
ON CONFLICT (id) DO NOTHING;

-- 3. agents
INSERT INTO public.agents (id, user_id, name, email, phone, agency_name, status, type, created_at, updated_at)
VALUES 
('b3c1b6a6-6417-43a3-a0c2-098d9343fea6', '73206680-77a8-4444-a006-258800185984', 'Edoardo', 'edoardo@inveniohomes.com', '+34633088538', 'Invenio Homes', 'approved', 'agency_admin', '2024-03-22 10:00:00+00', '2024-03-22 10:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 4. clients
INSERT INTO public.clients (id, agent_id, name, email, phone, created_at)
VALUES 
('c3c1b6a6-6417-43a3-a0c2-098d9343fea6', 'b3c1b6a6-6417-43a3-a0c2-098d9343fea6', 'Client One', 'client1@example.com', '+39000000000', '2024-03-23 15:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 5. invenio_properties
INSERT INTO public.invenio_properties (id, owner_id, name, description, location, bedrooms, bathrooms, max_guests, base_price, amenities, images, is_active, created_at, updated_at)
VALUES 
('d3c1b6a6-6417-43a3-a0c2-098d9343fea6', '2578b973-aa9b-4774-98da-4afd4edaf60d', 'Villa Mar', 'Wonderful sea view villa', 'Ibiza Town', 4, NULL, 8, 1500, ARRAY['Pool', 'WiFi', 'AC'], ARRAY['https://example.com/v1.jpg'], true, '2024-03-24 10:00:00+00', '2024-03-24 10:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 6. invenio_boats
INSERT INTO public.invenio_boats (id, owner_id, name, model, length, capacity, cabins, type, skipper, fuel, price_low, price_high, is_active, created_at, updated_at)
VALUES 
('e3c1b6a6-6417-43a3-a0c2-098d9343fea6', '2578b973-aa9b-4774-98da-4afd4edaf60d', 'Sea Breeze', 'Sunseeker Predator', 45, 12, 3, 'Motor', 'Included', 'Full-to-Full', 1500, 2500, true, '2024-03-25 09:00:00+00', '2024-03-25 09:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 7. invenio_photos
INSERT INTO public.invenio_photos (id, property_id, boat_id, url, "order", created_at)
VALUES 
('f3c1b6a6-6417-43a3-a0c2-098d9343fea6', NULL, 'e3c1b6a6-6417-43a3-a0c2-098d9343fea6', 'https://example.com/boat1.jpg', 1, '2024-03-25 11:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 8. invenio_seasonal_prices
INSERT INTO public.invenio_seasonal_prices (id, property_id, start_date, end_date, price, created_at)
VALUES 
('03c1b6a6-6417-43a3-a0c2-098d9343fea6', 'd3c1b6a6-6417-43a3-a0c2-098d9343fea6', '2024-06-01', '2024-08-31', 1800, '2024-03-24 12:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 9. quotes
INSERT INTO public.quotes (id, agent_id, client_id, property_id, boat_id, status, check_in, check_out, total_amount, deposit_amount, notes, created_at, updated_at)
VALUES 
('13c1b6a6-6417-43a3-a0c2-098d9343fea6', 'b3c1b6a6-6417-43a3-a0c2-098d9343fea6', 'c3c1b6a6-6417-43a3-a0c2-098d9343fea6', 'd3c1b6a6-6417-43a3-a0c2-098d9343fea6', NULL, 'sent', '2024-07-01', '2024-07-08', 12600, 6300, 'High season booking', '2024-03-26 10:00:00+00', '2024-03-26 10:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 10. user_roles
INSERT INTO public.user_roles (id, user_id, role, created_at)
VALUES 
('23c1b6a6-6417-43a3-a0c2-098d9343fea6', '73206680-77a8-4444-a006-258800185984', 'super_admin', '2024-03-20 10:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 11. guests
INSERT INTO public.guests (id, quote_id, name, email, passport_number, created_at)
VALUES 
('33c1b6a6-6417-43a3-a0c2-098d9343fea6', '13c1b6a6-6417-43a3-a0c2-098d9343fea6', 'Guest One', 'guest1@example.com', 'AB1234567', '2024-03-26 11:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 12. messages
INSERT INTO public.messages (id, quote_id, sender_id, content, created_at)
VALUES 
('43c1b6a6-6417-43a3-a0c2-098d9343fea6', '13c1b6a6-6417-43a3-a0c2-098d9343fea6', '73206680-77a8-4444-a006-258800185984', 'Hello, looking forward to your visit!', '2024-03-26 12:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 13. global_settings
INSERT INTO public.global_settings (id, margin, iva, company_name, company_email, updated_at)
VALUES 
('53c1b6a6-6417-43a3-a0c2-098d9343fea6', 0.2, 0.21, 'Ibiza Beyond', 'info@ibizabeyond.com', '2024-03-20 10:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 14. margin_settings
INSERT INTO public.margin_settings (id, is_admin, admin_margin, created_at)
VALUES 
('63c1b6a6-6417-43a3-a0c2-098d9343fea6', true, 0.2, '2024-03-20 10:00:00+00')
ON CONFLICT (id) DO NOTHING;
