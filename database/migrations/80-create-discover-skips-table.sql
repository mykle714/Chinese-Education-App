-- Migration 80: Create the `discover_skips` table (signal-free deferrals)
--
-- In the discover / sort-cards flow a "Skip for now" must carry NO level signal and
-- must NOT enter the user's library. Previously a skip was a vocabentries row with
-- starterPackBucket = 'skip' and an empty mark history, which resolved to
-- category = 'Unfamiliar' and POLLUTED the adaptive level estimate (it looked like a
-- card the user "doesn't know" at that level). Moving skips into their own table makes
-- them structurally invisible to the estimator (which reads only vocabentries).
--
-- Identity is (userId, language, cardId): one deferral per discoverable card per user.
-- `cardId` is the per-language dictionaryentries surrogate id — these ids COLLIDE
-- across languages, so every read/write is scoped by (language, cardId). createdAt
-- orders the recycle: when in-level supply is exhausted, the oldest skips re-enter
-- the candidate pool first.
--
-- A skip = INSERT here (ON CONFLICT DO NOTHING). Recycling = include these rows back
-- in the widened supply query. Undo of a skip = DELETE the matching row.
--
-- Idempotent: safe to re-run (table guarded; backfill is ON CONFLICT DO NOTHING and
-- only consumes skip rows that still exist).

CREATE TABLE IF NOT EXISTS discover_skips (
    id          SERIAL PRIMARY KEY,
    "userId"    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    language    VARCHAR(8)  NOT NULL,                            -- 'zh' | 'es'
    "cardId"    INTEGER     NOT NULL,                            -- dictionaryentries surrogate id (per-language)
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW() -- recycle ordering: oldest re-enters first
);

-- One deferral per (user, language, card): enables the skip upsert and the
-- "is this card currently skipped?" exclusion in the supply query.
CREATE UNIQUE INDEX IF NOT EXISTS idx_discover_skips_user_lang_card
    ON discover_skips ("userId", language, "cardId");

-- Supports the per-user recycle scan (oldest-first within a language).
CREATE INDEX IF NOT EXISTS idx_discover_skips_user_lang_created
    ON discover_skips ("userId", language, "createdAt");

COMMENT ON TABLE discover_skips
  IS 'Signal-free discover "skip for now" deferrals. One row per (userId, language, cardId). Deliberately separate from vocabentries so skips never feed the difficulty estimator.';

-- ---------------------------------------------------------------------------
-- Backfill: migrate existing skip-bucket vocabentries into discover_skips, then
-- remove them from vocabentries (their old home). Map entryKey -> det surrogate id
-- via the per-language dictionary table.
-- ---------------------------------------------------------------------------

-- Chinese: identity is word1.
INSERT INTO discover_skips ("userId", language, "cardId")
SELECT DISTINCT ve."userId", ve.language, de.id
FROM vocabentries_zh ve
JOIN dictionaryentries_zh de
  ON de.word1 = ve."entryKey" AND de.language = ve.language
WHERE ve."starterPackBucket" = 'skip'
ON CONFLICT DO NOTHING;

-- Spanish: identity is (word1, pos) — match the specific POS row.
INSERT INTO discover_skips ("userId", language, "cardId")
SELECT DISTINCT ve."userId", ve.language, de.id
FROM vocabentries_es ve
JOIN dictionaryentries_es de
  ON de.word1 = ve."entryKey" AND de.language = ve.language
 AND de.pos IS NOT DISTINCT FROM ve.pos
WHERE ve."starterPackBucket" = 'skip'
ON CONFLICT DO NOTHING;

-- Drop the now-migrated skip rows from vocabentries (skips no longer live there).
DELETE FROM vocabentries_zh WHERE "starterPackBucket" = 'skip';
DELETE FROM vocabentries_es WHERE "starterPackBucket" = 'skip';
