-- Rename all invenio_* identifiers to neutral names.
-- Invenio is one of multiple villa suppliers; the prefix is misleading.
-- Data preserved; FKs/policies follow renames via OID.

-- 1. Tables
ALTER TABLE public.invenio_properties      RENAME TO properties;
ALTER TABLE public.invenio_boats           RENAME TO boats;
ALTER TABLE public.invenio_photos          RENAME TO property_photos;
ALTER TABLE public.invenio_videos          RENAME TO property_videos;
ALTER TABLE public.invenio_seasonal_prices RENAME TO seasonal_prices;

-- 2. Column on margin_settings
ALTER TABLE public.margin_settings
    RENAME COLUMN invenio_to_admin_margin TO supplier_to_admin_margin;

-- 3. View
ALTER VIEW public.vw_invenio_seasonal_prices_shortstay
    RENAME TO vw_seasonal_prices_shortstay;

-- 4. Sequence
ALTER SEQUENCE public.invenio_videos_id_seq RENAME TO property_videos_id_seq;

-- 5. Trigger
ALTER TRIGGER update_invenio_boats_updated_at ON public.boats
    RENAME TO update_boats_updated_at;

-- 6. Constraints (PKs/FKs/checks). Renaming a PK constraint also renames its backing index.
ALTER TABLE public.boats
    RENAME CONSTRAINT invenio_boats_pkey                   TO boats_pkey;
ALTER TABLE public.boats
    RENAME CONSTRAINT invenio_boats_owner_id_fkey          TO boats_owner_id_fkey;
ALTER TABLE public.boats
    RENAME CONSTRAINT invenio_boats_created_by_fkey        TO boats_created_by_fkey;
ALTER TABLE public.boats
    RENAME CONSTRAINT invenio_boats_ingestion_source_check TO boats_ingestion_source_check;

ALTER TABLE public.property_photos
    RENAME CONSTRAINT invenio_photos_pkey            TO property_photos_pkey;
ALTER TABLE public.property_photos
    RENAME CONSTRAINT invenio_photos_v_uuid_fkey     TO property_photos_v_uuid_fkey;
ALTER TABLE public.property_photos
    RENAME CONSTRAINT invenio_photos_boat_uuid_fkey  TO property_photos_boat_uuid_fkey;

ALTER TABLE public.properties
    RENAME CONSTRAINT invenio_properties_pkey                              TO properties_pkey;
ALTER TABLE public.properties
    RENAME CONSTRAINT invenio_properties_owner_id_users_fkey               TO properties_owner_id_users_fkey;
ALTER TABLE public.properties
    RENAME CONSTRAINT invenio_properties_created_by_fkey                   TO properties_created_by_fkey;
ALTER TABLE public.properties
    RENAME CONSTRAINT invenio_properties_city_id_fkey                      TO properties_city_id_fkey;
ALTER TABLE public.properties
    RENAME CONSTRAINT invenio_properties_area_id_fkey                      TO properties_area_id_fkey;
ALTER TABLE public.properties
    RENAME CONSTRAINT invenio_properties_source_check                      TO properties_source_check;
ALTER TABLE public.properties
    RENAME CONSTRAINT invenio_properties_property_type_check               TO properties_property_type_check;
ALTER TABLE public.properties
    RENAME CONSTRAINT invenio_properties_capturer_commission_mode_check    TO properties_capturer_commission_mode_check;
ALTER TABLE public.properties
    RENAME CONSTRAINT invenio_properties_ingestion_source_check            TO properties_ingestion_source_check;

ALTER TABLE public.seasonal_prices
    RENAME CONSTRAINT invenio_seasonal_prices_pkey TO seasonal_prices_pkey;

ALTER TABLE public.property_videos
    RENAME CONSTRAINT invenio_videos_pkey            TO property_videos_pkey;
ALTER TABLE public.property_videos
    RENAME CONSTRAINT invenio_videos_v_uuid_fkey     TO property_videos_v_uuid_fkey;
ALTER TABLE public.property_videos
    RENAME CONSTRAINT invenio_videos_created_by_fkey TO property_videos_created_by_fkey;

-- 7. Standalone indexes (not constraint-backed)
ALTER INDEX public.invenio_boats_owner_id_idx       RENAME TO boats_owner_id_idx;
ALTER INDEX public.idx_inv_boats_created_by         RENAME TO idx_boats_created_by;

ALTER INDEX public.invenio_photos_boat_uuid_idx     RENAME TO property_photos_boat_uuid_idx;
ALTER INDEX public.idx_inv_photos_uuid              RENAME TO idx_property_photos_uuid;
ALTER INDEX public.idx_inv_photos_uuid_cover        RENAME TO idx_property_photos_uuid_cover;

ALTER INDEX public.invenio_properties_embedding_hnsw_idx RENAME TO properties_embedding_hnsw_idx;
ALTER INDEX public.invenio_properties_owner_id_idx  RENAME TO properties_owner_id_idx;
ALTER INDEX public.idx_inv_props_area_id            RENAME TO idx_properties_area_id;
ALTER INDEX public.idx_inv_props_city_id            RENAME TO idx_properties_city_id;
ALTER INDEX public.idx_inv_props_created_by         RENAME TO idx_properties_created_by;
ALTER INDEX public.idx_inv_props_dest               RENAME TO idx_properties_dest;
ALTER INDEX public.idx_inv_props_is_active          RENAME TO idx_properties_is_active;
ALTER INDEX public.idx_inv_props_source             RENAME TO idx_properties_source;

ALTER INDEX public.idx_inv_prices_uuid              RENAME TO idx_seasonal_prices_uuid;

ALTER INDEX public.idx_inv_videos_v_uuid            RENAME TO idx_property_videos_v_uuid;

-- 8. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
