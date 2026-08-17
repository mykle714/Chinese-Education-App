-- Teardown for the 55 Arena load-test accounts (prod, seeded 2026-08-16).
--
-- Scoped ENTIRELY by the '@arena-test.local' email suffix. No real account has that
-- suffix, so this cannot touch one. Verify before and after with the counts at the end.
--
-- user_languages."userId" and arena_members cascade from users.id, so deleting the
-- accounts is sufficient — but arena_members is cleared explicitly first so the count
-- is visible in the output rather than happening silently via ON DELETE CASCADE.

BEGIN;

-- 1. Remove them from any arena they were placed into.
DELETE FROM arena_members m
USING users u
WHERE m."userId" = u.id
  AND u.email LIKE '%@arena-test.local';

-- 2. Delete the accounts. user_languages cascades via the FK.
DELETE FROM users
WHERE email LIKE '%@arena-test.local';

COMMIT;

-- 3. Arenas emptied by the above are left in place but may now be undersized or empty.
--    Inspect before deciding; an empty arena is harmless but untidy.
SELECT a.id, a."weekKey", count(m.*) AS remaining_members
FROM arenas a LEFT JOIN arena_members m ON m."arenaId" = a.id
GROUP BY a.id, a."weekKey"
ORDER BY a.id;

-- 4. Expect: test_users = 0, real_users = 15.
SELECT count(*) FILTER (WHERE email LIKE '%@arena-test.local') AS test_users,
       count(*) FILTER (WHERE email NOT LIKE '%@arena-test.local') AS real_users
FROM users;
