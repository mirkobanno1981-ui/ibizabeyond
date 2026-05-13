-- Persist AI-classified room_type per photo so the gallery can be
-- re-sorted by space type without re-running extraction.

ALTER TABLE public.property_photos
  ADD COLUMN IF NOT EXISTS room_type text;

CREATE INDEX IF NOT EXISTS property_photos_room_type_idx
  ON public.property_photos(room_type);
