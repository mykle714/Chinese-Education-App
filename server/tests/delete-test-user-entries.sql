-- Delete all vocabulary entries for the test user
-- First, let's find the user ID for test@example.com
-- Then delete all their vocab entries

-- Option 1: Delete using email (recommended)
DELETE FROM VocabEntries 
WHERE userId = (
    SELECT id FROM Users WHERE email = 'test@example.com'
);

-- Option 2: If you want to see the user ID first, run this query:
-- SELECT id, email, name FROM Users WHERE email = 'test@example.com';

-- Option 3: Delete all entries for user with specific ID (replace with actual ID)
-- DELETE FROM VocabEntries WHERE userId = 'your-user-id-here';

-- To verify deletion, you can run:
-- SELECT COUNT(*) as remaining_entries FROM VocabEntries 
-- WHERE userId = (SELECT id FROM Users WHERE email = 'test@example.com');
