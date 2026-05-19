ALTER TABLE properties ALTER COLUMN destination SET DEFAULT 'Ibiza';
UPDATE properties SET destination = 'Ibiza' WHERE destination IS NULL;
