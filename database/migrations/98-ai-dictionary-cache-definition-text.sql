-- Migration 98: Lift the length limit on `ai_dictionary_cache.definition`
--
-- The AI synthetic-entry gloss (docs/DICTIONARY_AI_FALLBACK_SEARCH.md) was capped at varchar(100),
-- which truncated richer answers (e.g. 喜茶 → "…cheese tea and fruit t"). The card UI wraps the full
-- text with no clamp, so the only cap was this column + the server-side truncateGloss safety net —
-- both now removed. Widen the column to unbounded text; the prompt still asks for a concise,
-- complete definition, but longer answers are no longer clipped.
--
-- Non-destructive (varchar(100) → text preserves existing values). Idempotent: safe to re-run.

ALTER TABLE ai_dictionary_cache
  ALTER COLUMN definition TYPE text;
