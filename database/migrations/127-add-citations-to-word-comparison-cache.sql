-- Migration 127: Add `citations` to word_comparison_cache
--
-- The Compare tab's AI paragraph cites Chinese inline exactly like a long definition does
-- ("高兴 as in 我很高兴"), and gets the same embedded-Chinese treatment at read time. This
-- column stores the English translation of each cited Chinese run so a tap highlights the
-- WHOLE run and shows its translation, instead of popping one segment's gloss.
--
-- Shape mirrors dictionaryentries_zh."longDefinitionCitations" (migration 126) — same
-- concept, same column name root, so the two paths share one vocabulary and one renderer:
--   [ { "zh": "我很高兴", "en": "I am very happy." } ]
--
-- Compare is a LIVE path, so these are produced by the comparison call itself: the prompt
-- now asks for a structured { paragraph, citations } JSON payload rather than bare prose,
-- which keeps it at ONE model call per pair. `comparison` still stores only the paragraph
-- text, so every existing reader is unaffected.
--
-- NULLABLE, and rows cached before this migration keep NULL: they serve exactly as they
-- do today (per-segment popups) and only gain citations if the pair is ever regenerated.
-- No bulk regeneration and no cache invalidation (decided 2026-07-26) — an old pair is not
-- worth an AI call nobody asked for.
--
-- Idempotent: safe to re-run.

ALTER TABLE word_comparison_cache
  ADD COLUMN IF NOT EXISTS citations jsonb;

COMMENT ON COLUMN word_comparison_cache.citations IS
  'jsonb array of { zh, en }: English translations for the Chinese runs embedded in the comparison paragraph, produced by the same model call. NULL on rows cached before migration 127 — those keep the per-segment popup. See docs/WORD_COMPARE_FEATURE.md.';
