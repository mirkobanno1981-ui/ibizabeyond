-- Add editor-boat to user_role enum.
-- Must run in own transaction (cannot ADD VALUE and use it in the same TX).

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'editor-boat';
