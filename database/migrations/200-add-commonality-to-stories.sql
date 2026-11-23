-- Migration 200: Adventures (cyoa) — measure a story by COMMONALITY instead of difficulty.
--
-- Design: docs/CYOA_FEATURE.md § 6.2a (column approved by the owner 2026-11-21). Code:
-- server/contracts/stories.ts (computeStoryCommonality), server/services/StoryService.ts
-- (computeCommonality, recomputeCommonality), server/dal/implementations/StoryDAL.ts
-- (publish, setCommonality, listForViewer ORDER BY), src/features/cyoa/AdventuresPage.tsx.
--
-- Why: word difficulty (det `difficulty`) stopped being shown to learners on 2026-11-21, so
-- a story's "HSK n" label (derived from it) went too. The story is now measured on det
-- `frequencyScore`'s 1–5 commonality scale (5 = everyday) by the same 90%-coverage rule,
-- walked from the common end: the HIGHEST C such that ≥ 90% of the story's distinct scored
-- words have frequencyScore ≥ C. NULL until first publish, or when no word is scored.
--
-- EXPAND half of an expand/contract pair. This adds the new column and its list index; the
-- old `difficulty` column is dropped by the HELD-BACK migration 205 after the new code is
-- live. Existing published stories get their value from
-- server/scripts/backfill/cyoa/backfill-story-commonality.ts (segmentation runs in the
-- service, so it cannot be done in SQL). See docs/STORY_COMMONALITY_DEPLOY_RUNBOOK.md.

ALTER TABLE stories
    ADD COLUMN IF NOT EXISTS commonality smallint CHECK (commonality BETWEEN 1 AND 5);

COMMENT ON COLUMN stories.commonality IS
    'Commonality 1-5 on dictionaryentries frequencyScore scale (5 = everyday), computed on publish: the highest score that at least 90% of the story distinct scored words reach. NULL until first publish. Migration 200, docs/CYOA_FEATURE.md section 6.2a.';

-- The learner list: published stories of a language, most common (easiest) first, then newest.
-- Replaces stories_published_list_idx (language, difficulty, ...) from migration 196.
DROP INDEX IF EXISTS stories_published_list_idx;
CREATE INDEX IF NOT EXISTS stories_published_list_idx
    ON stories (language, commonality DESC NULLS LAST, "publishedAt" DESC) WHERE "publishedAt" IS NOT NULL;
