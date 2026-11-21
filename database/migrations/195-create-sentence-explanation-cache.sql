-- Migration 195: Create `sentence_explanation_cache` — per-learner AI explanations of a Reader sentence
--
-- Backs the Reader's sentence Explain (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence
-- Explain"). A second-tier long-press (desktop: double-click) highlights a whole sentence; the
-- rdb's Explain key asks the AI to break down its grammar and whatever meaning the per-word
-- dictionary entries cannot show. The server reads this table first and only calls the model
-- on a miss.
--
-- PER-USER, not shared (owner's call 2026-11-20): the prompt is tailored to the learner — their
-- estimated level (StarterPacksService.estimateLevel) and their mastery of each word in the
-- sentence — so one learner's explanation is not valid for another. Identity is therefore
-- ("userId", sentence, language, "promptVersion").
--
-- `promptVersion` is part of the key: a bumped prompt (SentenceExplanationService →
-- SENTENCE_EXPLAIN_PROMPT_VERSION) misses on every old row and regenerates on the next ask;
-- the old rows are kept, not overwritten, so versions can be compared.
--
-- No expiry for now (owner's call 2026-11-20): a row is served forever even though the
-- learner's mastery moves on. `createdAt` is kept so a future staleness rule can be added.
--
-- Explain requests share the per-user daily AI budget (`dictionary_ai_usage`, migration 100)
-- and the `DICT_AI_API_KEY` client with the dictionary AI fallback and Compare. Cache hits are
-- free.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS sentence_explanation_cache (
  id              serial      PRIMARY KEY,
  "userId"        varchar     NOT NULL,   -- users.id of the learner the explanation was tailored to
  sentence        text        NOT NULL,   -- the exact, trimmed sentence string (as highlighted)
  language        varchar(8)  NOT NULL,   -- 'zh' (es paused)
  explanation     text        NOT NULL,   -- the AI-generated explanation (plain text, \n\n between paragraphs)
  citations       jsonb,                  -- [{zh, en}] translation per Chinese run cited in `explanation`
  "promptVersion" integer     NOT NULL,   -- SENTENCE_EXPLAIN_PROMPT_VERSION that produced it
  model           varchar,                -- model id that produced it (regeneration bookkeeping)
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", sentence, language, "promptVersion")
);

COMMENT ON TABLE sentence_explanation_cache IS
  'Per-learner cache of AI sentence explanations from the Reader (grammar breakdown tailored to the learner''s level and word mastery). Keyed by (userId, sentence, language, promptVersion); no expiry. See docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Sentence Explain.';
