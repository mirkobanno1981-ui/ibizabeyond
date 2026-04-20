-- Partial index for cover-photo lookup used by the villa search page.
-- Prior plan did a Seq Scan over all invenio_photos rows filtering sort_order = 0.
-- With ~12k photos and ~250 covers, a partial index on (v_uuid) WHERE sort_order = 0
-- turns the lookup into a Bitmap Index Scan (~1ms vs ~90ms).
CREATE INDEX IF NOT EXISTS idx_inv_photos_uuid_cover
    ON invenio_photos (v_uuid)
    WHERE sort_order = 0;
