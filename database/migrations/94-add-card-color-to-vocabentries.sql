-- Migration 94: Add `cardColor` to the per-language vocabentries (vet) tables
--
-- Persists the flashcard icon-editor's CARD background-color setting per card
-- (docs/CARD_ICON_LAYOUT.md). The advanced editor's "card" menu (formerly "contrast")
-- now groups BOTH the per-text-run color overrides (migration 89 `textColors`) AND a
-- single card-background swatch. A learner picks one of six fills; the choice tints the
-- whole flashcard face (both sides) and the mini card thumbnails.
--
-- Stored as a raw CSS hex string (e.g. '#F5EBE0'), NOT a palette key, so the render path
-- can apply it directly with no lookup. NULL = the "auto" option = no override → the card
-- follows the active theme's default face color. The offered chips (2 rows in the UI) are:
-- Row 1 (neutrals):
--   NULL       → auto    (follow the theme; shown as the red no-fill glyph)
--   '#D8D8DC'  → grey    (COLORS.card — the explicit light-theme grey)
--   '#F5EBE0'  → beige   (light beige; shares the infoCard surface color)
--   '#FFFFFF'  → white
--   '#000000'  → black
-- Row 2 (pastel hues):
--   '#F2BAC9'  → red     (COLORS.redAccent)
--   '#BAF2D8'  → green   (COLORS.greenAccent)
--   '#BAD7F2'  → blue    (COLORS.blueAccent)
--   '#F2E2BA'  → yellow  (COLORS.yellowAccent)
--   '#D8BAF2'  → purple  (COLORS.purpleAccent)
-- The server validates any incoming value against this exact set (see
-- VocabEntryService.validateCardColor), so only these fills — or NULL — are ever stored.
--
-- Like `iconLayout` (migration 82), `snapConfig` (88), `textColors` (89), and `textLayout`
-- (91), this is per-user-per-word, so it lives on the vet row (identity
-- (userId, entryKey, language)) — NOT on the shared det icon.
--
-- Written together with `iconLayout` by the same PATCH /api/vocabEntries/:id/icon-layout
-- (folded into the editor's Save), so Cancel discards the card-color change too.
-- Reset-to-default clears it to NULL alongside the layout.
--
-- The column flows into reads automatically: vocab reads select `ve.*` and the zh read
-- wrapper (vetReadFrom) uses `SELECT *`, so no select-list changes are needed.
--
-- Idempotent: safe to re-run.

ALTER TABLE vocabentries_zh
  ADD COLUMN IF NOT EXISTS "cardColor" text;

ALTER TABLE vocabentries_es
  ADD COLUMN IF NOT EXISTS "cardColor" text;

COMMENT ON COLUMN vocabentries_zh."cardColor" IS
  'Per-card flashcard background fill (CSS hex, one of the six editor swatches). NULL = follow theme. See docs/CARD_ICON_LAYOUT.md.';

COMMENT ON COLUMN vocabentries_es."cardColor" IS
  'Per-card flashcard background fill (CSS hex, one of the six editor swatches). NULL = follow theme. See docs/CARD_ICON_LAYOUT.md.';
