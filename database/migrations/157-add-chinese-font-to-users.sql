-- Migration 157: account-level Chinese typeface preference.
--
-- The app rendered every Chinese glyph in Noto Sans SC, hardcoded into the FONTS.cjk
-- token. `FONTS.cjk` now resolves to `var(--cjk-font, <the old stack>)`, so the face is
-- a runtime choice; this column is where that choice lives, alongside the other
-- account-level display preferences (readingGoal/writingGoal, migration 101;
-- showSegmentSpaces, migration 129).
--
-- STORES A CATALOG ID, NOT A CSS FAMILY NAME. A family name would strand every row the
-- day a face is renamed or re-sourced. Valid ids are CHINESE_FONT_IDS in
-- server/contracts/wire.ts, presented by src/theme/cjkFontOptions.ts.
--
-- DEFAULT '975-maru' is for NEW accounts. Every row that exists at migration time is
-- explicitly set back to 'noto-sans-sc' by the UPDATE below, so no existing account's
-- Chinese text silently changes typeface — they opt in from Settings instead.
--
-- See docs/CJK_TYPEFACE_LAB.md.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "chineseFont" text NOT NULL DEFAULT '975-maru';

-- Pre-existing accounts keep the face they have always seen. This runs once, against
-- the rows present when the column is added; new signups take the column DEFAULT.
UPDATE users SET "chineseFont" = 'noto-sans-sc';

COMMENT ON COLUMN users."chineseFont" IS
  'Typeface used to render Chinese characters. A catalog id (NOT a CSS family name) from CHINESE_FONT_IDS in server/contracts/wire.ts; presented by src/theme/cjkFontOptions.ts. Account-level display preference, migration 157. New accounts default to 975-maru; accounts predating the migration were backfilled to noto-sans-sc. See docs/CJK_TYPEFACE_LAB.md';
