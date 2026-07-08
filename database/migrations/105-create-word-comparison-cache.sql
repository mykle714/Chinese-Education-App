-- Migration 105: Create `word_comparison_cache` — cache for AI-generated word-comparison paragraphs
--
-- Backs the eip Compare tab (docs/WORD_COMPARE_FEATURE.md). A learner picks two words to compare;
-- the server asks Sonnet to explain the difference and caches the answer here so the same pair
-- never pays a second model call.
--
-- Identity is (`wordA`, `wordB`, `language`), an UNORDERED pair: the service canonically sorts the
-- two words (codepoint order) before both read and write, so comparing A-vs-B and B-vs-A share one
-- row and one model call — the prompt is symmetric ("difference between X and Y"), so direction
-- carries no meaning.
--
-- Unlike `ai_dictionary_cache` (migration 97) there is no "empty result" state: the model always
-- produces a comparison for two real det words, so no NULL-marker/staleness machinery is needed.
-- `queriedAt` is kept for manual invalidation/regeneration bookkeeping only.
--
-- Compare requests share the existing per-user daily AI budget (`dictionary_ai_usage`, migration
-- 100) and the existing `DICT_AI_API_KEY` — no new rate-limit table or env var.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS word_comparison_cache (
  id           serial      PRIMARY KEY,
  "wordA"      varchar     NOT NULL,   -- canonically-ordered pair: wordA < wordB (codepoint order)
  "wordB"      varchar     NOT NULL,
  language     varchar(8)  NOT NULL,   -- 'zh' | 'es'; both words are in this language
  comparison   text        NOT NULL,   -- the AI-generated free-text comparison paragraph
  model        varchar,                -- model id that produced it (regeneration bookkeeping)
  "queriedAt"  timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("wordA", "wordB", language)
);

COMMENT ON TABLE word_comparison_cache IS
  'Cache of AI-generated comparison paragraphs for a pair of det words. wordA/wordB is a canonically-sorted unordered pair (service sorts before read/write) so both comparison directions share one row/model call. See docs/WORD_COMPARE_FEATURE.md.';
