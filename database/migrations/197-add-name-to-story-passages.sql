-- Migration 197: Adventures (cyoa) — an author-written NAME per passage.
--
-- Design: docs/CYOA_FEATURE.md § 6.2d (column approved by the owner 2026-11-20).
-- Code: server/dal/implementations/StoryDAL.ts (PASSAGE_SELECT, savePassage),
-- server/services/StoryService.ts (normalizePassageName), server/contracts/stories.ts
-- (STORY_PASSAGE_NAME_MAX_LENGTH, StoryPassageEdit.name).
--
-- An organizing label for the AUTHOR only — edited in the passage editor's header and
-- shown in the story editor's passage rows, the choice target picker and the
-- incoming-choice lines. Never served to learners (the play wire types do not carry it).
-- NULL = unnamed: the editor falls back to "Passage n" (creation order). StoryService
-- stores a blank name as NULL, so '' never reaches the column.
--
-- Additive and nullable: safe to auto-run by migrate.sh ahead of the new code (old code
-- never reads or writes it).

ALTER TABLE story_passages ADD COLUMN IF NOT EXISTS name text;

COMMENT ON COLUMN story_passages.name IS
  'Author-only organizing label (passage editor header). NULL = unnamed → "Passage n". Max 200 chars, whitespace-collapsed (StoryService.normalizePassageName). Migration 197.';
