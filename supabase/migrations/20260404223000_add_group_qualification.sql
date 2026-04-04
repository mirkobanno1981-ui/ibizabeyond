-- Migration: Add Group Qualification to Quotes
-- Date: 2026-04-04

-- Add group_details column to quotes table if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='group_details') THEN
        ALTER TABLE quotes ADD COLUMN group_details JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- Update schema dump for future reference
-- (Note: This is a comment as we don't automate full SQL dump updates here)
