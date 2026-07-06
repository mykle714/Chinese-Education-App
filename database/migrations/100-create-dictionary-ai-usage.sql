-- Migration 100: Create `dictionary_ai_usage` — per-user daily AI-lookup counter (abuse limit)
--
-- Backs the daily rate limit on the dictionary search's stage-3 AI fallback
-- (docs/DICTIONARY_AI_FALLBACK_SEARCH.md). Each COMPLETED model call from
-- `POST /api/dictionary/ai-entry` (a cache MISS that actually reaches Sonnet +
-- web_search) increments `count` for the caller's local streak-day. When `count`
-- reaches DICTIONARY_AI_DAILY_LIMIT (server/constants.ts, default 10) the endpoint
-- returns HTTP 429 and the client shows a "daily limit reached" note.
--
-- Why this is now needed (migration 97 said it wasn't): the AI fallback originally
-- only accepted numbered pinyin — a finite space the cache saturates, so repeat
-- model calls trend to zero. It now also accepts arbitrary Chinese-character queries
-- and issues up to 3 web searches per tap, so an individual user can drive unbounded
-- billed calls. This per-user cap closes that.
--
-- Identity is (`userId`, `usageDate`):
--   userId    = users.id of the caller.
--   usageDate = the caller's 4 AM-bounded LOCAL calendar day (streakDateOf, the same
--               boundary used by streaks/minute points), computed server-side from
--               users.timezone. The counter therefore resets at 4 AM local time.
--
-- Cache HITS do not count: the model-call short-circuit happens before the increment,
-- so re-viewing a prior AI answer (or any auto-rendered orange card) is always free.
--
-- Old rows are harmless (a few bytes per user per active day); prune with a periodic
-- `DELETE FROM dictionary_ai_usage WHERE "usageDate" < current_date - 30` if desired.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS dictionary_ai_usage (
  "userId"    varchar NOT NULL,   -- users.id of the caller
  "usageDate" date    NOT NULL,   -- caller's local streak-day (YYYY-MM-DD)
  count       int     NOT NULL DEFAULT 0,
  UNIQUE ("userId", "usageDate")
);

COMMENT ON TABLE dictionary_ai_usage IS
  'Per-user, per-local-day counter of COMPLETED AI dictionary-fallback model calls; enforces the daily abuse limit (server/constants.ts DICTIONARY_AI_DAILY_LIMIT). Cache hits are not counted. See docs/DICTIONARY_AI_FALLBACK_SEARCH.md.';
