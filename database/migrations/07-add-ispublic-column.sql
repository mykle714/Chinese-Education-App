-- Migration: Add isPublic column to Users table
-- Purpose: Add privacy control for leaderboard visibility
-- New users default to public (true), existing users default to private (false)

-- Add the isPublic column with default true for new users
ALTER TABLE Users 
ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true;

-- Set all existing users to private (false)
UPDATE Users 
SET "isPublic" = false;

-- Create an index for efficient filtering
CREATE INDEX idx_users_ispublic ON Users("isPublic");

-- Comments
COMMENT ON COLUMN Users."isPublic" IS 'Whether user appears on public leaderboard. New users default to true, existing users migrated to false.';
