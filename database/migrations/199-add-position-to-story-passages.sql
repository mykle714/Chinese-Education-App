-- Migration 199: Adventures (cyoa) — an author-set ORDER for a story's passages.
--
-- Design: docs/CYOA_FEATURE.md § 5.3 (column approved by the owner 2026-11-21). Code:
-- server/dal/implementations/StoryDAL.ts (listPassages ORDER BY, createPassage,
-- reorderPassages), server/services/StoryService.ts (reorderPassages),
-- src/features/cyoa/StoryPassageList.tsx (the drag handle).
--
-- The story editor lists passages in this order and authors drag them to reorder. It also
-- numbers unnamed passages: "Passage n" = the nth row (owner's call 2026-11-21 — the number
-- follows the list, so moving a row renumbers the unnamed rows it passes).
--
-- 1-based per story. Gaps are allowed (a deleted passage leaves one); only the ORDER means
-- anything. A new passage takes MAX + 1. UNIQUE (storyId, position) is DEFERRABLE so the
-- reorder's single UPDATE can swap positions — a deferrable constraint is checked at the end
-- of the statement, not per row.
--
-- Existing rows are backfilled in creation order (the order the editor showed until now).
--
-- DEPLOY: ships in the same batch as migrations 196–198 (cyoa has never reached PPE), so
-- the NOT NULL never meets the old createPassage. Standard /deploy.

ALTER TABLE story_passages ADD COLUMN IF NOT EXISTS position integer;

UPDATE story_passages p
   SET position = ordered.n
  FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY "storyId" ORDER BY "createdAt", id) AS n
          FROM story_passages
       ) ordered
 WHERE ordered.id = p.id
   AND p.position IS NULL;

ALTER TABLE story_passages ALTER COLUMN position SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_passages_story_position_key') THEN
        ALTER TABLE story_passages
            ADD CONSTRAINT story_passages_story_position_key UNIQUE ("storyId", position)
            DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
END $$;

COMMENT ON COLUMN story_passages.position IS
  'Author-set order in the story editor (drag to reorder), 1-based per story, gaps allowed. Unnamed passages are labelled "Passage n" by this order. Migration 199, docs/CYOA_FEATURE.md § 5.3.';
