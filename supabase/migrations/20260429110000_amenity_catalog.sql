-- Predefined amenity catalog grouped by category.
-- Villa features remain stored as text[] on invenio_properties.features —
-- catalog labels are written verbatim into that array, so legacy free-form
-- features keep working.

CREATE TABLE IF NOT EXISTS amenity_catalog (
  id          SERIAL PRIMARY KEY,
  category    TEXT    NOT NULL,
  label       TEXT    NOT NULL UNIQUE,
  icon        TEXT,
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS amenity_catalog_category_idx
  ON amenity_catalog (category, sort_order);

ALTER TABLE amenity_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amenity_catalog_read_all ON amenity_catalog;
CREATE POLICY amenity_catalog_read_all ON amenity_catalog
  FOR SELECT USING (true);

DROP POLICY IF EXISTS amenity_catalog_admin_write ON amenity_catalog;
CREATE POLICY amenity_catalog_admin_write ON amenity_catalog
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role IN ('admin','super_admin')
    )
  );

INSERT INTO amenity_catalog (category, label, icon, sort_order) VALUES
  ('outdoor',  'Pool',                    'pool',                10),
  ('outdoor',  'Infinity Pool',           'pool',                20),
  ('outdoor',  'Heated Pool',             'hot_tub',             30),
  ('outdoor',  'Jacuzzi',                 'hot_tub',             40),
  ('outdoor',  'BBQ',                     'outdoor_grill',       50),
  ('outdoor',  'Outdoor Kitchen',         'outdoor_grill',       60),
  ('outdoor',  'Garden',                  'park',                70),
  ('outdoor',  'Tennis Court',            'sports_tennis',       80),
  ('outdoor',  'Padel Court',             'sports_tennis',       90),
  ('outdoor',  'Outdoor Dining',          'deck',               100),
  ('outdoor',  'Chill-out Area',          'weekend',            110),
  ('outdoor',  'Outdoor Shower',          'shower',             120),

  ('indoor',   'Fireplace',               'fireplace',           10),
  ('indoor',   'Gym',                     'fitness_center',      20),
  ('indoor',   'Cinema Room',             'theaters',            30),
  ('indoor',   'Wine Cellar',             'wine_bar',            40),
  ('indoor',   'Game Room',               'sports_esports',      50),
  ('indoor',   'Library',                 'menu_book',           60),
  ('indoor',   'Office',                  'work',                70),
  ('indoor',   'Walk-in Closet',          'checkroom',           80),

  ('services', 'Daily Cleaning',          'cleaning_services',   10),
  ('services', 'Concierge',               'support_agent',       20),
  ('services', 'Chef on Request',         'restaurant',          30),
  ('services', 'Butler',                  'room_service',        40),
  ('services', 'Babysitting',             'child_care',          50),
  ('services', 'Airport Transfer',        'flight',              60),
  ('services', 'Security',                'security',            70),
  ('services', 'Laundry',                 'local_laundry_service', 80),

  ('view',     'Sea View',                'waves',               10),
  ('view',     'Sunset View',             'wb_twilight',         20),
  ('view',     'Sunrise View',            'wb_sunny',            30),
  ('view',     'Countryside View',        'landscape',           40),
  ('view',     'Mountain View',           'terrain',             50),
  ('view',     'Beachfront',              'beach_access',        60),
  ('view',     'Cliffside',               'landscape',           70),

  ('wellness', 'Sauna',                   'sauna',               10),
  ('wellness', 'Hammam',                  'spa',                 20),
  ('wellness', 'Massage Room',            'spa',                 30),
  ('wellness', 'Yoga Space',              'self_improvement',    40),
  ('wellness', 'Meditation Area',         'self_improvement',    50),
  ('wellness', 'Cold Plunge',             'pool',                60),

  ('tech',     'Wi-Fi',                   'wifi',                10),
  ('tech',     'Smart TV',                'tv',                  20),
  ('tech',     'Sonos',                   'speaker',             30),
  ('tech',     'Smart Home',              'home_iot_device',     40),
  ('tech',     'EV Charger',              'ev_station',          50),
  ('tech',     'Air Conditioning',        'ac_unit',             60),
  ('tech',     'Underfloor Heating',      'thermostat',          70),
  ('tech',     'Alarm System',            'shield',              80)
ON CONFLICT (label) DO NOTHING;
