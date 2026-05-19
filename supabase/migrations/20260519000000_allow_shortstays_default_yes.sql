ALTER TABLE properties ALTER COLUMN allow_shortstays SET DEFAULT 'yes';
UPDATE properties SET allow_shortstays = 'yes' WHERE allow_shortstays IS NULL OR allow_shortstays = 'no' OR allow_shortstays = '0';
