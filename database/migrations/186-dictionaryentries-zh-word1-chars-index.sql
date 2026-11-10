-- Migration 186: a GIN index over the CHARACTERS of dictionaryentries_zh.word1.
--
-- WHY: the used-in lists ("words that contain 人", shown for a single-character card in
-- deals, refills, the eip and the writing bar) ask "which det words contain this
-- character?". The old pass 2 answered that with `position(ch IN d.word1) > 0`, which no
-- index can serve, so every character read the whole table (114,701 zh rows ≈ 91 MB of
-- buffers, ~26 ms for 人 on dev, measured 2026-11-09), once per single-character card.
--
-- WHY NOT pg_trgm: a trigram index cannot narrow a ONE-character pattern. Tried inside a
-- rolled-back transaction: `LIKE '%人%'` over a gin_trgm_ops index matched all 114,701
-- rows and took 35 ms, slower than the scan.
--
-- WHAT WORKS: index each word as its array of characters (`string_to_array(word1, NULL)`
-- splits a string into single characters) and ask containment with `@>`. Same test:
-- 2 ms for 人, and rarer characters are faster still.
--
-- The query side is `charsContainClause` in server/dal/implementations/VocabEntryDAL.ts,
-- which must use the EXACT expression below for the planner to match it.
--
-- DEPLOY: safe under the standard /deploy, in either order. Old code ignores the index;
-- new code is correct without it (just slower). migrate.sh runs each file in a
-- transaction, so this cannot be CONCURRENTLY; the build takes about a second and
-- briefly blocks writes to the table, which only the backfill cron does.
--
-- Referenced by: docs/DEFERRED_WORK.md (scaling table, row 3), docs/CONSTRUCTS.md (`usedIn`).

CREATE INDEX IF NOT EXISTS idx_dictionaryentries_zh_word1_chars
    ON dictionaryentries_zh USING gin (string_to_array(word1, NULL));
