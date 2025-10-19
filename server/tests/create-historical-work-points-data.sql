-- Create realistic historical work points data for October 2025
-- This demonstrates the calendar visualization with various learning patterns
-- User: reader-vocab-test@example.com (354f37b7-22bf-4cda-a969-1f2536c714a3)

-- Clear any existing data for this user in October 2025
DELETE FROM UserWorkPoints 
WHERE "userId" = '354f37b7-22bf-4cda-a969-1f2536c714a3' 
AND date >= '2025-10-01' 
AND date <= '2025-10-31';

-- October 2025 Historical Data
-- Green days (5+ points) = streak maintained, show +points
-- Red days (0-4 points) = penalty applied, show -10

INSERT INTO UserWorkPoints ("userId", date, "deviceFingerprint", "workPoints") VALUES

-- Week 1: Starting strong, then missing a day
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-01', 'device_laptop_001', 8),  -- Wednesday: +8 (GREEN)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-02', 'device_laptop_001', 12), -- Thursday: +12 (GREEN)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-03', 'device_laptop_001', 6),  -- Friday: +6 (GREEN)
-- Oct 4 (Saturday): No entry = 0 points = -10 penalty (RED)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-05', 'device_phone_001', 5),   -- Sunday: +5 (GREEN) - back on track

-- Week 2: Good streak with one bad day
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-06', 'device_laptop_001', 15), -- Monday: +15 (GREEN) - excellent session
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-07', 'device_laptop_001', 9),  -- Tuesday: +9 (GREEN)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-08', 'device_phone_001', 3),   -- Wednesday: +3 but -10 penalty (RED)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-09', 'device_laptop_001', 7),  -- Thursday: +7 (GREEN) - recovered

-- Oct 10 (Friday): Today - will be highlighted specially
-- (Don't insert today's data since it should come from current session)

-- Week 3: Mixed performance
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-11', 'device_tablet_001', 11), -- Saturday: +11 (GREEN) - weekend study
-- Oct 12 (Sunday): No entry = 0 points = -10 penalty (RED)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-13', 'device_laptop_001', 5),  -- Monday: +5 (GREEN) - minimum threshold
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-14', 'device_laptop_001', 18), -- Tuesday: +18 (GREEN) - great session
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-15', 'device_phone_001', 2),   -- Wednesday: +2 but -10 penalty (RED)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-16', 'device_laptop_001', 14), -- Thursday: +14 (GREEN)

-- Week 4: Building a good streak
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-17', 'device_laptop_001', 8),  -- Friday: +8 (GREEN)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-18', 'device_tablet_001', 6),  -- Saturday: +6 (GREEN)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-19', 'device_laptop_001', 10), -- Sunday: +10 (GREEN)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-20', 'device_laptop_001', 13), -- Monday: +13 (GREEN)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-21', 'device_phone_001', 7),   -- Tuesday: +7 (GREEN)

-- Week 5: Some inconsistency
-- Oct 22 (Wednesday): No entry = 0 points = -10 penalty (RED)
-- Oct 23 (Thursday): No entry = 0 points = -10 penalty (RED)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-24', 'device_laptop_001', 16), -- Friday: +16 (GREEN) - comeback
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-25', 'device_laptop_001', 4),  -- Saturday: +4 but -10 penalty (RED)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-26', 'device_tablet_001', 9),  -- Sunday: +9 (GREEN)

-- Final week: Strong finish
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-27', 'device_laptop_001', 11), -- Monday: +11 (GREEN)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-28', 'device_laptop_001', 20), -- Tuesday: +20 (GREEN) - excellent
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-29', 'device_phone_001', 8),   -- Wednesday: +8 (GREEN)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-30', 'device_laptop_001', 6),  -- Thursday: +6 (GREEN)
('354f37b7-22bf-4cda-a969-1f2536c714a3', '2025-10-31', 'device_laptop_001', 12); -- Friday: +12 (GREEN) - month end strong

-- Summary for October 2025 calendar:
-- Green days (5+ points): 1,2,3,5,6,7,9,11,13,14,16,17,18,19,20,21,24,26,27,28,29,30,31 = 23 days
-- Red days (penalty): 4,8,12,15,22,23,25 = 7 days  
-- Today (Oct 10): Will be highlighted based on current session
-- Shows realistic learning patterns with streaks, gaps, and recovery
