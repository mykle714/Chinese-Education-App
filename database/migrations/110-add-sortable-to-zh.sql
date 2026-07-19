-- Migration 110: Discover "sortable" flag (lazy-enrichment)
--
-- Decouples "showable in the discover sort/quick-mark flows" from "fully enriched
-- and safe to ship everywhere". See docs/DISCOVER_LAZY_ENRICHMENT.md.
--
-- Background: `discoverable = TRUE` has meant "fully enriched + data-deployed" and
-- is the gate for the flashcard/reader/dictionary surfaces AND for /data-deploy. It
-- is declared "illegal to set outside the /mark-discoverable pipeline" (CLAUDE.md).
-- The lazy-enrichment plan needs cards visible in the discover flows BEFORE full
-- enrichment, so we split the two concepts:
--
--   * discoverable (unchanged) — "fully enriched + data-deployed".
--   * sortable    (new, this migration) — "level-assigned (difficulty ∈ 1..6) and
--                 lead gloss cleaned; safe to show as a discover sort card." The
--                 discover supply queries (StarterPacksService._fetchSupplyRows,
--                 listQuickMarkCards, getProgress) gate on THIS for zh.
--
-- Invariant: discoverable = TRUE  ⇒  sortable = TRUE (enforced by the backfill below;
-- future writers that set discoverable must also set sortable — see the on-first-sort
-- worker, which flips both).
--
-- Zh-only for now (matches docs/DISCOVER_LAZY_ENRICHMENT.md scope). Spanish keeps
-- gating on `discoverable`; an es `sortable` follows if/when es joins the flow.
--
-- Idempotent (IF NOT EXISTS on the column + index; the backfill is a plain UPDATE
-- that is safe to re-run).

-- ── 1. sortable column ────────────────────────────────────────────────────────
ALTER TABLE dictionaryentries_zh
    ADD COLUMN IF NOT EXISTS sortable BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN dictionaryentries_zh.sortable IS
    'Whether this entry may be shown as a discover sort/quick-mark card (level-assigned + lead gloss cleaned). Weaker than discoverable; discoverable=TRUE implies sortable=TRUE. See docs/DISCOVER_LAZY_ENRICHMENT.md.';

-- ── 2. backfill existing qualifying rows ──────────────────────────────────────
-- A row is already showable when it has a valid level (difficulty ∈ 1..6, the hard
-- filter the discover flows apply) OR is already discoverable (⇒ sortable). This is
-- the same set the corpus pre-pass will grow going forward.
UPDATE dictionaryentries_zh
    SET sortable = true
    WHERE sortable = false
      AND (discoverable = true OR difficulty BETWEEN 1 AND 6);

-- ── 3. partial index for the supply queries ───────────────────────────────────
-- Mirrors idx_dictionary_discoverable_language but on the sortable gate. The discover
-- supply queries filter (language = 'zh' AND sortable AND difficulty BETWEEN 1 AND 6),
-- so index (language, difficulty) over just the sortable rows.
CREATE INDEX IF NOT EXISTS idx_dictionary_sortable_language
    ON dictionaryentries_zh (language, difficulty)
    WHERE sortable = true;
