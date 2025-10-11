-- Add total work points column to Users table
-- This will store the lifetime accumulated work points for each user

ALTER TABLE Users 
ADD COLUMN "totalWorkPoints" INTEGER NOT NULL DEFAULT 0;

-- Create index for performance on total work points queries
CREATE INDEX IF NOT EXISTS idx_users_total_work_points ON Users("totalWorkPoints");

-- Initialize existing users with their historical total work points
-- Sum all work points from UserWorkPoints table, ignoring device fingerprints since we're treating as single device
WITH user_totals AS (
    SELECT 
        "userId",
        COALESCE(SUM("workPoints"), 0) as calculated_total
    FROM UserWorkPoints
    GROUP BY "userId"
)
UPDATE Users 
SET "totalWorkPoints" = user_totals.calculated_total
FROM user_totals
WHERE Users.id = user_totals."userId";

-- Add helpful comment
COMMENT ON COLUMN Users."totalWorkPoints" IS 'Lifetime accumulated work points across all learning activities';
