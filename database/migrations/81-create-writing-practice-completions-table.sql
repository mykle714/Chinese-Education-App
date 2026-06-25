-- Migration 81: Create the `writing_practice_completions` table
--
-- Tracks per-user completion of the character writing-practice drill. A "completion"
-- is the FIRST successful Verify (target === recognizer top-1) of a given assistance
-- level for a given character. Each completed level earns the user one star toward
-- that character (max 4: trace, walkthrough, memorize, test). See docs/HANDWRITING_RECOGNITION.md.
--
-- Shape: row-per-first-completion (Shape A). The unique constraint makes repeated
-- successes idempotent, so the table is STATE, not history — bounded at <=4 rows per
-- (user, character): one per level. Stars(character) = COUNT(*) grouped by entryKey.
-- A completion = INSERT ... ON CONFLICT DO NOTHING. This is deliberately NOT an event
-- log; if practice history/analytics are needed later, add a separate append-only table.
--
-- Identity is (userId, language, entryKey, level): one row per level per character per
-- user. `entryKey` matches the vet identity convention and is the single character
-- being practiced (the feature is single-character, zh-only for now). `level` is the
-- popup tab mode string.
--
-- Idempotent: safe to re-run (table + indexes guarded with IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS writing_practice_completions (
    id            SERIAL PRIMARY KEY,
    "userId"      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    language      VARCHAR(8)  NOT NULL,                             -- 'zh'
    "entryKey"    VARCHAR     NOT NULL,                             -- the single character practiced
    level         VARCHAR(16) NOT NULL,                             -- 'trace' | 'walkthrough' | 'memorize' | 'test'
    "completedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()   -- first-success timestamp
);

-- One completion per (user, language, character, level): enables the ON CONFLICT
-- upsert and guarantees the bounded <=4-rows-per-character invariant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_writing_practice_user_lang_entry_level
    ON writing_practice_completions ("userId", language, "entryKey", level);

-- Supports the per-character star lookup (which levels are done / how many stars)
-- for the practice button superscript and the popup tab stars.
CREATE INDEX IF NOT EXISTS idx_writing_practice_user_lang_entry
    ON writing_practice_completions ("userId", language, "entryKey");

COMMENT ON TABLE writing_practice_completions
  IS 'Writing-practice completion state. One row per first successful Verify of a (userId, language, entryKey, level). Bounded <=4 rows/character/user; stars = COUNT grouped by entryKey. State, not history.';
