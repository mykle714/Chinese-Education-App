-- Add userId and isUserCreated columns to texts table for user-specific documents
-- Migration: 08-add-userid-to-texts.sql

-- Add userId column (nullable for existing system texts)
ALTER TABLE texts 
ADD COLUMN "userId" UUID REFERENCES users(id) ON DELETE CASCADE;

-- Add isUserCreated flag to distinguish user documents from system texts
ALTER TABLE texts 
ADD COLUMN "isUserCreated" BOOLEAN NOT NULL DEFAULT false;

-- Create index for faster user-specific queries
CREATE INDEX IF NOT EXISTS idx_texts_userid ON texts("userId");

-- Create composite index for userId + language queries
CREATE INDEX IF NOT EXISTS idx_texts_userid_language ON texts("userId", language);

-- Update existing texts to be marked as system texts (not user-created)
UPDATE texts SET "isUserCreated" = false WHERE "userId" IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN texts."userId" IS 'Foreign key to users table. NULL for system texts, set for user-created documents';
COMMENT ON COLUMN texts."isUserCreated" IS 'Flag to distinguish user-created documents from system texts';
