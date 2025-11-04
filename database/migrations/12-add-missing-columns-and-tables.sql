-- Comprehensive migration to add all missing columns and tables
-- This migration brings production database up to date with development
-- Created: 2025-11-04

-- Step 1: Create UserWorkPoints table for daily work points tracking
CREATE TABLE IF NOT EXISTS UserWorkPoints (
    "userId" UUID NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    "deviceFingerprint" VARCHAR(255) NOT NULL,
    "workPoints" INTEGER NOT NULL DEFAULT 0,
    "lastSyncTimestamp" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT pk_userworkpoints PRIMARY KEY ("userId", date, "deviceFingerprint")
);

-- Create indexes for UserWorkPoints
CREATE INDEX IF NOT EXISTS idx_userworkpoints_user_date ON UserWorkPoints("userId", date);
CREATE INDEX IF NOT EXISTS idx_userworkpoints_date ON UserWorkPoints(date);
CREATE INDEX IF NOT EXISTS idx_userworkpoints_user_recent ON UserWorkPoints("userId", date DESC);

-- Create trigger function for UserWorkPoints updatedAt
CREATE OR REPLACE FUNCTION update_userworkpoints_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for UserWorkPoints
DROP TRIGGER IF EXISTS trigger_update_userworkpoints_updated_at ON UserWorkPoints;
CREATE TRIGGER trigger_update_userworkpoints_updated_at
    BEFORE UPDATE ON UserWorkPoints
    FOR EACH ROW
    EXECUTE FUNCTION update_userworkpoints_updated_at();

-- Add comments for UserWorkPoints
COMMENT ON TABLE UserWorkPoints IS 'Stores daily work points accumulated by users per device for learning activity tracking';
COMMENT ON COLUMN UserWorkPoints."workPoints" IS 'Total work points earned for the day on this device (calculated by client)';
COMMENT ON COLUMN UserWorkPoints."deviceFingerprint" IS 'Device identifier to support users studying on multiple devices';

-- Step 2: Add isPublic column to Users table
ALTER TABLE Users 
ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT true;

-- Create index for isPublic
CREATE INDEX IF NOT EXISTS idx_users_ispublic ON Users("isPublic");

-- Add comment for isPublic
COMMENT ON COLUMN Users."isPublic" IS 'Whether user appears on public leaderboard. New users default to true.';

-- Step 3: Add totalWorkPoints column to Users table
ALTER TABLE Users 
ADD COLUMN IF NOT EXISTS "totalWorkPoints" INTEGER NOT NULL DEFAULT 0;

-- Create index for totalWorkPoints
CREATE INDEX IF NOT EXISTS idx_users_total_work_points ON Users("totalWorkPoints");

-- Add comment for totalWorkPoints
COMMENT ON COLUMN Users."totalWorkPoints" IS 'Lifetime accumulated work points across all learning activities';

-- Note: Since UserWorkPoints table is being created fresh, there's no historical data to initialize totalWorkPoints with
-- All existing users will start with totalWorkPoints = 0
