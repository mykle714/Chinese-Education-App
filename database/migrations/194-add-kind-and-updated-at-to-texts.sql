-- Migration 194: Add `kind` and `updatedAt` to the `texts` table (Reader Journal + sorting)
--
-- `kind` — which Reader collection a document belongs to. The `/reader` page shows two
-- toggle tiles, Documents and Journal (src/features/reader/ReaderCollectionTiles.tsx);
-- selecting one filters the list to that collection. A journal entry is an ordinary
-- document in every other respect (same editor, same reading view). It is created by
-- tapping New document while the Journal tile is selected, and its card shows its
-- `createdAt` date. A TEXT enum rather than an `isJournal` boolean so a further
-- collection is one CHECK edit, not another column (owner's call, 2026-11-17).
-- Existing rows, and the system texts, are all 'document'.
--
-- `updatedAt` — when the document was last saved. Drives the list's "Recently edited"
-- sort (src/features/reader/useReaderListSort.ts). Set by TextDAL.updateFields on every
-- update. Backfilled from `createdAt`, so an untouched document sorts as though it was
-- last edited when it was created.
--
-- Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Collections (Documents / Journal)"
-- and § "Sorting".
-- Idempotent: safe to re-run.

ALTER TABLE texts
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'document';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_texts_kind'
    ) THEN
        ALTER TABLE texts
          ADD CONSTRAINT chk_texts_kind CHECK (kind IN ('document', 'journal'));
    END IF;
END $$;

ALTER TABLE texts
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP;  -- same type as "createdAt" (no tz)

-- Backfill, then lock down: every row has a last-edited time from here on.
-- COALESCE: "createdAt" is itself nullable (no NOT NULL on it), so a row without one
-- gets the migration time rather than failing the NOT NULL below.
UPDATE texts SET "updatedAt" = COALESCE("createdAt", now()) WHERE "updatedAt" IS NULL;
ALTER TABLE texts ALTER COLUMN "updatedAt" SET DEFAULT now();
ALTER TABLE texts ALTER COLUMN "updatedAt" SET NOT NULL;

COMMENT ON COLUMN texts.kind IS
  'Reader collection: ''document'' (default) or ''journal''. Journal entries are created from the Reader''s Journal tile and show their createdAt date.';
COMMENT ON COLUMN texts."updatedAt" IS
  'Last save time (TextDAL.updateFields). Backfilled from createdAt by migration 194. Drives the Reader list''s "Recently edited" sort.';
