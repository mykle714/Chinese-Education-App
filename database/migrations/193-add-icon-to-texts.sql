-- Migration 193: Add `iconId` to the `texts` table (Reader document icons)
--
-- Lets a learner pick one icons8 icon for each of their Reader documents, from the
-- edit toolbar's icon button (src/features/reader/ReaderEditToolbar.tsx →
-- IconPickerDialog). The icon is shown in the toolbar's preview and as the document
-- row's avatar on the `/reader` list (TextSidebar.tsx). Rendered client-side via the
-- public image endpoint GET /api/icons8/<id>/image, exactly like users."avatarIconId"
-- (migration 77) and det."iconId" (migration 72).
--
-- Nullable: NULL = no icon chosen; the list falls back to the default glyph
-- (`description` for a user document, `menu_book` for a built-in text).
--
-- ON DELETE SET NULL: if an icon row is ever removed from icons8, referencing
-- documents simply lose their icon rather than blocking the delete. icons8 is
-- merge-synced, never truncated (docs/DATA_DEPLOYMENT_GUIDE.md), so this FK does not
-- obstruct the data pulls.
--
-- Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Document icon".
-- Idempotent: safe to re-run.

ALTER TABLE texts
  ADD COLUMN IF NOT EXISTS "iconId" TEXT;

-- FK added separately so the migration stays idempotent.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_texts_icon'
    ) THEN
        ALTER TABLE texts
          ADD CONSTRAINT fk_texts_icon
          FOREIGN KEY ("iconId") REFERENCES icons8("icons8Id") ON DELETE SET NULL;
    END IF;
END $$;

-- Index the FK column so the ON DELETE SET NULL sweep stays cheap.
CREATE INDEX IF NOT EXISTS idx_texts_icon_id ON texts("iconId");

COMMENT ON COLUMN texts."iconId" IS
  'Optional FK to icons8("icons8Id"): the icon the learner picked for this Reader document, rendered via GET /api/icons8/<id>/image. NULL = default glyph. ON DELETE SET NULL.';
