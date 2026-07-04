-- Migration 97: Create `ai_dictionary_cache` — cache for AI-synthesized dictionary entries
--
-- Backs the dictionary search's stage-3 fallback (docs/DICTIONARY_AI_FALLBACK_SEARCH.md).
-- When a numbered/spaceless pinyin query matches no real `dictionaryentries_zh` row, the user
-- may tap an "AI" pill; the server asks Sonnet for a synthetic entry (word1 + tone-marked pinyin
-- + one ≤100-char gloss) and caches the answer here so the same query never pays a second model
-- call. The dictionary search also reads this table (exact-match on `queryKey`) on every search,
-- so a prior AI answer shows up automatically (rendered as an unclickable orange card).
--
-- Identity is (`queryKey`, `language`):
--   queryKey  = the exact trimmed raw user input (NOT normalized — 'jian4shen1' and 'jian4 shen1'
--               are deliberately separate rows; the finite pinyin space still saturates the cache).
--   language  = 'zh' for now (reserved so other languages can reuse the table later).
--
-- An "empty result" (AI could not determine a likely meaning) is represented by `word1 IS NULL`
-- (no separate flag column). `queriedAt` drives the staleness rule: an EMPTY row older than
-- 3 months is treated as a cache miss so the "AI" pill reappears and the model is re-prompted on
-- the next tap. Non-empty rows never expire.
--
-- No rate limiting is needed: valid queries are restricted to pinyin-formatted strings, a finite
-- space that this cache eventually saturates, so repeated model calls trend to zero.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ai_dictionary_cache (
  id          serial PRIMARY KEY,
  "queryKey"  varchar     NOT NULL,   -- exact trimmed raw user input
  language    varchar(8)  NOT NULL,   -- 'zh'
  word1       varchar,                -- NULL => empty result (no likely meaning)
  pinyin      varchar,                -- tone-marked (diacritics)
  definition  varchar(100),           -- one concise gloss, <= 100 chars
  "queriedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("queryKey", language)
);

COMMENT ON TABLE ai_dictionary_cache IS
  'Cache of AI-synthesized dictionary entries for pinyin queries with no real det match. word1 NULL = empty result; queriedAt drives the 3-month empty-row re-prompt. See docs/DICTIONARY_AI_FALLBACK_SEARCH.md.';
