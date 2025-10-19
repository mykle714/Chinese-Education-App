-- Create sample work points data for leaderboard demonstration
-- This will create varied data to showcase the leaderboard functionality

-- Get today's and yesterday's dates
DO $$
DECLARE
    today_date DATE := CURRENT_DATE;
    yesterday_date DATE := CURRENT_DATE - INTERVAL '1 day';
    two_days_ago DATE := CURRENT_DATE - INTERVAL '2 days';
    three_days_ago DATE := CURRENT_DATE - INTERVAL '3 days';
    four_days_ago DATE := CURRENT_DATE - INTERVAL '4 days';
    five_days_ago DATE := CURRENT_DATE - INTERVAL '5 days';
    one_week_ago DATE := CURRENT_DATE - INTERVAL '7 days';
BEGIN

-- Clear existing work points data to avoid duplicates
DELETE FROM UserWorkPoints;

-- User 1: test@example.com (4bd6c2a0-b22a-4679-93e3-43782b6db8d4)
-- High performer yesterday, good streak
INSERT INTO UserWorkPoints ("userId", date, "deviceFingerprint", "workPoints") VALUES
('4bd6c2a0-b22a-4679-93e3-43782b6db8d4', yesterday_date, 'device1', 25),  -- Yesterday: 25 points (HIGH - should rank #1)
('4bd6c2a0-b22a-4679-93e3-43782b6db8d4', today_date, 'device1', 15),      -- Today: 15 points
('4bd6c2a0-b22a-4679-93e3-43782b6db8d4', two_days_ago, 'device1', 20),    -- Building streak
('4bd6c2a0-b22a-4679-93e3-43782b6db8d4', three_days_ago, 'device1', 18),  -- Building streak
('4bd6c2a0-b22a-4679-93e3-43782b6db8d4', four_days_ago, 'device1', 12),   -- Building streak
('4bd6c2a0-b22a-4679-93e3-43782b6db8d4', five_days_ago, 'device1', 8),    -- Building streak
('4bd6c2a0-b22a-4679-93e3-43782b6db8d4', one_week_ago, 'device1', 10);    -- Historical data

-- User 2: empty@test.com (11111111-1111-1111-1111-111111111111)
-- Zero points yesterday (should rank last)
INSERT INTO UserWorkPoints ("userId", date, "deviceFingerprint", "workPoints") VALUES
('11111111-1111-1111-1111-111111111111', today_date, 'device1', 5),        -- Today: 5 points
('11111111-1111-1111-1111-111111111111', three_days_ago, 'device1', 8),    -- Some historical activity
('11111111-1111-1111-1111-111111111111', one_week_ago, 'device1', 3);      -- Historical data

-- User 3: small@test.com (22222222-2222-2222-2222-222222222222)
-- Moderate performer yesterday
INSERT INTO UserWorkPoints ("userId", date, "deviceFingerprint", "workPoints") VALUES
('22222222-2222-2222-2222-222222222222', yesterday_date, 'device1', 12),   -- Yesterday: 12 points (MEDIUM)
('22222222-2222-2222-2222-222222222222', today_date, 'device1', 20),       -- Today: 20 points (very active today)
('22222222-2222-2222-2222-222222222222', two_days_ago, 'device1', 15),     -- Building streak
('22222222-2222-2222-2222-222222222222', three_days_ago, 'device1', 10),   -- Building streak
('22222222-2222-2222-2222-222222222222', four_days_ago, 'device1', 6),     -- Building streak
('22222222-2222-2222-2222-222222222222', one_week_ago, 'device1', 14);     -- Historical data

-- User 4: large@test.com (33333333-3333-3333-3333-333333333333)
-- High total points but low yesterday performance
INSERT INTO UserWorkPoints ("userId", date, "deviceFingerprint", "workPoints") VALUES
('33333333-3333-3333-3333-333333333333', yesterday_date, 'device1', 3),    -- Yesterday: 3 points (LOW despite high total)
('33333333-3333-3333-3333-333333333333', today_date, 'device1', 8),        -- Today: 8 points
('33333333-3333-3333-3333-333333333333', two_days_ago, 'device1', 30),     -- Was very active 2 days ago
('33333333-3333-3333-3333-333333333333', three_days_ago, 'device1', 25),   -- High historical activity
('33333333-3333-3333-3333-333333333333', four_days_ago, 'device1', 22),    -- High historical activity
('33333333-3333-3333-3333-333333333333', five_days_ago, 'device1', 28),    -- High historical activity
('33333333-3333-3333-3333-333333333333', one_week_ago, 'device1', 35);     -- Very high historical activity

-- User 5: reader-vocab-test@example.com (354f37b7-22bf-4cda-a969-1f2536c714a3)
-- Good yesterday performance, multi-device user
INSERT INTO UserWorkPoints ("userId", date, "deviceFingerprint", "workPoints") VALUES
('354f37b7-22bf-4cda-a969-1f2536c714a3', yesterday_date, 'device1', 18),   -- Yesterday device 1: 18 points
('354f37b7-22bf-4cda-a969-1f2536c714a3', yesterday_date, 'device2', 2),    -- Yesterday device 2: 2 points (Total: 20 - should rank #2)
('354f37b7-22bf-4cda-a969-1f2536c714a3', today_date, 'device1', 12),       -- Today device 1: 12 points
('354f37b7-22bf-4cda-a969-1f2536c714a3', today_date, 'device2', 5),        -- Today device 2: 5 points (Total: 17)
('354f37b7-22bf-4cda-a969-1f2536c714a3', two_days_ago, 'device1', 16),     -- Multi-device historical data
('354f37b7-22bf-4cda-a969-1f2536c714a3', three_days_ago, 'device1', 11),   -- Building streak
('354f37b7-22bf-4cda-a969-1f2536c714a3', four_days_ago, 'device1', 9),     -- Building streak
('354f37b7-22bf-4cda-a969-1f2536c714a3', one_week_ago, 'device1', 13);     -- Historical data

-- Update total work points for all users based on the data we just inserted
UPDATE Users SET "totalWorkPoints" = (
    SELECT COALESCE(SUM("workPoints"), 0) 
    FROM UserWorkPoints 
    WHERE UserWorkPoints."userId" = Users.id
);

END $$;

-- Verify the data was created correctly
SELECT 
    u.email,
    u."totalWorkPoints",
    COALESCE(yesterday.points, 0) as yesterday_points,
    COALESCE(today.points, 0) as today_points
FROM Users u
LEFT JOIN (
    SELECT 
        "userId",
        SUM("workPoints") as points
    FROM UserWorkPoints 
    WHERE date = CURRENT_DATE - INTERVAL '1 day'
    GROUP BY "userId"
) yesterday ON u.id = yesterday."userId"
LEFT JOIN (
    SELECT 
        "userId", 
        SUM("workPoints") as points
    FROM UserWorkPoints 
    WHERE date = CURRENT_DATE
    GROUP BY "userId"
) today ON u.id = today."userId"
ORDER BY yesterday_points DESC, u."totalWorkPoints" DESC;
