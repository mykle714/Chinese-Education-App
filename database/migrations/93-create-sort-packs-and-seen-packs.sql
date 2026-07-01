-- Migration 93: Create `sort_packs` (authored discover sort packs) + `users.seenPacks`
--
-- The discover / sort-cards flow moves from single-card sorting to MULTI-CARD SORT
-- PACKS (see docs/SORT_PACKS_IMPLEMENTATION.md, docs/SORT_CARDS_REQUIREMENTS.md §4.5).
-- The on-deck unit becomes a "sort pack": one sentence + up to 3 cards to sort.
--
-- Two pack sources:
--   - AUTHORED packs — hand-curated per level, stored here. Each carries its own
--     authored sentence + translation and references up to 3 discoverable det cards.
--   - SYSTEM fallback packs-of-1 — built on the fly from a single word's own first
--     example sentence; NOT stored (no row here).
--
-- No stored gloss: the cpcdRow is enriched on the fly from `sentenceForeign` at serve
-- time via DictionaryDAL.enrichExampleSentencesMetadataBatch (same path as est), so
-- there is nothing to precompute. zh gets the pinyin overlay; es renders plain text.
--
-- `seenPacks`: a per-user record of authored pack ids the user has finished (all cards
-- sorted) OR skipped, so a pack is never shown twice (requirements §4.5). sort_packs.id
-- is globally unique (single table), so one un-scoped INTEGER[] is unambiguous across
-- languages. Undo of the completing/skipping action removes the id again (array_remove).
--
-- Idempotent: guarded with IF NOT EXISTS so re-running is a no-op.

-- ---------------------------------------------------------------------------
-- Authored sort packs (reference data; synced to prod via /data-deploy).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sort_packs (
    id                SERIAL PRIMARY KEY,
    language          VARCHAR(8) NOT NULL,          -- 'zh' | 'es'
    level             SMALLINT   NOT NULL,          -- 1..6 (matches det.difficulty, migration 92)
    "packOrder"       INTEGER    NOT NULL,          -- curation sort key within (language, level)
    "sentenceForeign" TEXT       NOT NULL,          -- authored sentence (zh chars / es text)
    "sentenceEnglish" TEXT       NOT NULL,          -- authored English translation
    "entryIds"        INTEGER[]  NOT NULL           -- up to 3 det surrogate ids (the draggable cards)
);

-- Supports the supply scan: authored packs at/near a level, in curation order.
CREATE INDEX IF NOT EXISTS idx_sort_packs_lang_level_order
    ON sort_packs (language, level, "packOrder");

COMMENT ON TABLE sort_packs
  IS 'Authored discover sort packs: one sentence + up to 3 det cards (entryIds). Served nearest-level-first by packOrder; fallback packs-of-1 are built on the fly and NOT stored here.';

-- ---------------------------------------------------------------------------
-- Per-user "packs already seen" record (finished or skipped authored packs).
-- ---------------------------------------------------------------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "seenPacks" INTEGER[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN users."seenPacks"
  IS 'Authored sort_packs.id values the user has finished or skipped; a seen pack is never served again. Un-scoped across languages because sort_packs.id is globally unique.';
