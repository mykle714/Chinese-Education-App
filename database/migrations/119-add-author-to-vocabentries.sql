-- Migration 119: attribute each advanced card-icon design to its AUTHOR.
--
-- A "community design" is just a vet row whose `iconLayout` is advanced (docs/COMMUNITY_PAGE.md).
-- Applying someone else's design copies their jsonb onto the viewer's own row, so the same
-- artwork multiplies across users and the Community feeds fill up with duplicates of one design.
--
-- `author` records WHO designed the layout that currently sits in `iconLayout`:
--   * the icon editor writes the saving user's id whenever the layout actually CHANGES
--     (an unchanged re-save keeps the existing attribution),
--   * the community apply path copies the source design's author through, so a copy credits
--     the original designer rather than the copier.
-- The feeds then collapse rows sharing (entryKey, author, iconLayout) down to one.
--
-- NULL means "no recorded author" — every pre-existing row, and any row whose layout is not a
-- design. Reads treat it as self-authored via COALESCE(author, "userId"), so no backfill is
-- needed. ON DELETE SET NULL: losing the author account must not delete a learner's card.
--
-- Additive + idempotent.

ALTER TABLE vocabentries_zh
    ADD COLUMN IF NOT EXISTS author UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE vocabentries_es
    ADD COLUMN IF NOT EXISTS author UUID REFERENCES users(id) ON DELETE SET NULL;

-- Feed dedupe groups by (entryKey, author) before comparing layouts; the language/entryKey
-- filters already narrow hard, so a plain author index is enough to keep the grouping cheap.
CREATE INDEX IF NOT EXISTS idx_vocabentries_zh_author ON vocabentries_zh(author);
CREATE INDEX IF NOT EXISTS idx_vocabentries_es_author ON vocabentries_es(author);

COMMENT ON COLUMN vocabentries_zh.author IS
    'User who designed the layout currently in "iconLayout" (community attribution). Set by the '
    'icon editor on a changed save, and carried over unchanged when a community design is copied. '
    'NULL = unattributed/legacy; reads use COALESCE(author, "userId").';

COMMENT ON COLUMN vocabentries_es.author IS
    'User who designed the layout currently in "iconLayout" (community attribution). Set by the '
    'icon editor on a changed save, and carried over unchanged when a community design is copied. '
    'NULL = unattributed/legacy; reads use COALESCE(author, "userId").';
