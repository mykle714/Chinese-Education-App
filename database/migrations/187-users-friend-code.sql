-- Migration 187: users."friendCode" — a short, read-aloud-able handle for adding a friend.
--
-- WHY: adding a friend used to mean pasting their `users.id`, a 36-character UUID — large,
-- intimidating, and impossible to read out to someone across a table. A friend code is
-- 8 characters, shown as XXXX-XXXX (e.g. "K7QM-3XRA").
--
-- FORMAT (stored WITHOUT the hyphen, uppercase; the hyphen is display-only):
--   alphabet = 23456789ABCDEFGHJKMNPQRSTVWXYZ — 30 symbols. Dropped: 0/O, 1/I/L (each pair
--   is confusable when read or handwritten) and U (avoids accidental words). 30^8 ≈ 6.6e11
--   codes, so they are not enumerable by guessing and practically never collide.
-- The SAME alphabet lives in server/contracts/wire.ts → FRIEND_CODE_ALPHABET; change both
-- together. Input normalisation (strip hyphens/spaces, uppercase) is in
-- server/services/FriendsService.ts → `normalizeFriendCode`.
--
-- NEW ROWS get a code from the column DEFAULT (`generate_friend_code()`), which re-rolls on
-- the (astronomically rare) clash with an existing code. Two concurrent signups rolling the
-- same code would still trip the UNIQUE constraint — one signup 500s; accepted at this size.
--
-- DEPLOY: safe under the standard /deploy, in either order. Old code never selects the
-- column; new code reads it from every row because this migration backfills before NOT NULL.
--
-- Referenced by: docs/FRIENDS_FEATURE.md § "Friend codes", server/dal/implementations/UserDAL.ts
-- (`findById`, `findByFriendCode`).

CREATE OR REPLACE FUNCTION generate_friend_code() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
    code text;
BEGIN
    LOOP
        code := '';
        FOR i IN 1..8 LOOP
            code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
        END LOOP;
        -- Re-roll on a clash. Safe to reference users here: the function only runs as a
        -- column default / in the backfill below, both after the column exists.
        EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE "friendCode" = code);
    END LOOP;
    RETURN code;
END;
$$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS "friendCode" text;

-- Backfill one row at a time so each call sees the codes already assigned (a set-based
-- UPDATE would evaluate every row's EXISTS against the pre-update snapshot).
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT id FROM users WHERE "friendCode" IS NULL LOOP
        UPDATE users SET "friendCode" = generate_friend_code() WHERE id = r.id;
    END LOOP;
END;
$$;

ALTER TABLE users ALTER COLUMN "friendCode" SET DEFAULT generate_friend_code();
ALTER TABLE users ALTER COLUMN "friendCode" SET NOT NULL;
-- Format guard: exactly 8 symbols from the alphabet above.
ALTER TABLE users ADD CONSTRAINT users_friend_code_format
    CHECK ("friendCode" ~ '^[2-9A-HJKMNP-TV-Z]{8}$');
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_friend_code ON users ("friendCode");
