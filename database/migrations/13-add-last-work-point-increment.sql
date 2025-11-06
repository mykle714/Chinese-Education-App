-- Add lastWorkPointIncrement column to Users table for rate limiting
-- This tracks when the user last successfully incremented their work points
-- Used to enforce the 59-second minimum between increments

ALTER TABLE Users 
ADD COLUMN "lastWorkPointIncrement" TIMESTAMP DEFAULT NULL;

-- Add index for efficient lookups
CREATE INDEX idx_users_last_work_point_increment ON Users("lastWorkPointIncrement");

-- Add comment explaining the column
COMMENT ON COLUMN Users."lastWorkPointIncrement" IS 'Timestamp of last successful work point increment. Used for rate limiting (59 second minimum between increments). Only updated on successful operations to allow retries on failures.';
