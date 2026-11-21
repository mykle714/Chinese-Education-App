-- Migration 198: Adventures (cyoa) — the passages each learner has SEEN in a story.
--
-- Design: docs/CYOA_FEATURE.md § 3.6b "Pages found" (table approved by the owner
-- 2026-11-21). Code: server/dal/implementations/StoryDAL.ts (recordPassageSeen,
-- listPassagesSeen), server/services/StoryService.ts (arrive), server/contracts/stories.ts
-- (StoryPlayStep.passagesSeen / passagesTotal), src/features/cyoa/StoryEndPanel.tsx.
--
-- One row per passage a learner has been SERVED, across every play of the story — the
-- numerator of the end card's "Pages found x/y" (y = the story's passages, counted at read
-- time). Shaped like story_endings_found (migration 196): PK (userId, passageId) so a
-- revisit is an ON CONFLICT no-op, storyId denormalised so the per-story read is one
-- indexed scan, every FK cascading (a deleted passage drops out of x and y together).
--
-- Per-user data: NOT on /data-ppe-to-dev's pull list (like story_progress and
-- story_endings_found).
--
-- Additive: safe to auto-run by migrate.sh ahead of the new code (old code never reads it).

CREATE TABLE IF NOT EXISTS story_passages_seen (
    "userId"    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "storyId"   uuid        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    "passageId" uuid        NOT NULL REFERENCES story_passages(id) ON DELETE CASCADE,
    "seenAt"    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("userId", "passageId")
);

CREATE INDEX IF NOT EXISTS story_passages_seen_user_story_idx
    ON story_passages_seen ("userId", "storyId");

COMMENT ON TABLE story_passages_seen IS
    'Adventures (cyoa): one row per passage a learner has been served, across all plays — the numerator of the end card''s "Pages found x/y". Migration 198, docs/CYOA_FEATURE.md § 3.6b.';
