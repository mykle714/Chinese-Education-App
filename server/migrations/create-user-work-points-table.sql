-- Create UserWorkPoints table for daily work points tracking
-- Primary key is composite of userId + date + deviceFingerprint to support multi-device usage
-- Supports updates for late syncing of previous days' work
CREATE TABLE IF NOT EXISTS UserWorkPoints (
    "userId" UUID NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    "deviceFingerprint" VARCHAR(255) NOT NULL, -- Device identifier for multi-device support
    "workPoints" INTEGER NOT NULL DEFAULT 0, -- Work points earned for the day on this device
    "lastSyncTimestamp" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Composite primary key: user + date + device
    CONSTRAINT pk_userworkpoints PRIMARY KEY ("userId", date, "deviceFingerprint")
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_userworkpoints_user_date ON UserWorkPoints("userId", date);
CREATE INDEX IF NOT EXISTS idx_userworkpoints_date ON UserWorkPoints(date); -- For analytics
CREATE INDEX IF NOT EXISTS idx_userworkpoints_user_recent ON UserWorkPoints("userId", date DESC); -- For recent work queries

-- Create trigger to automatically update updatedAt on row updates
CREATE OR REPLACE FUNCTION update_userworkpoints_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_userworkpoints_updated_at ON UserWorkPoints;
CREATE TRIGGER trigger_update_userworkpoints_updated_at
    BEFORE UPDATE ON UserWorkPoints
    FOR EACH ROW
    EXECUTE FUNCTION update_userworkpoints_updated_at();

-- Add some helpful comments
COMMENT ON TABLE UserWorkPoints IS 'Stores daily work points accumulated by users per device for learning activity tracking';
COMMENT ON COLUMN UserWorkPoints."workPoints" IS 'Total work points earned for the day on this device (calculated by client)';
COMMENT ON COLUMN UserWorkPoints."deviceFingerprint" IS 'Device identifier to support users studying on multiple devices';
COMMENT ON COLUMN UserWorkPoints."updatedAt" IS 'Timestamp of last sync update (for handling late syncs of previous days)';
COMMENT ON CONSTRAINT pk_userworkpoints ON UserWorkPoints IS 'Composite primary key allows one entry per user per day per device';
