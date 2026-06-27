-- Migration 86: Create the `community_layout_votes` table
--
-- Tracks upvotes for community-shared ADVANCED card-icon layouts (the per-word icon
-- arrangements stored in vet."iconLayout", migration 82 — see docs/CARD_ICON_LAYOUT.md and
-- docs/COMMUNITY_PAGE.md). The Community page surfaces other users' advanced layouts in two
-- feeds; a viewer can upvote a design at most once per week and copy it onto their own card.
--
-- A "design" is identified by its OWNER's vet row, i.e. (ownerUserId, entryKey, language) —
-- one specific user's saved layout on one word. We deliberately reference that logical
-- identity rather than the owner vet row's numeric `id` so a vote survives the row being
-- deleted + re-created (same word, same user), and so a design's vote tally is stable even
-- if the owner edits/re-saves the arrangement in place.
--
-- This is an append-only event log (one row per cast vote), NOT a per-design counter:
--   * "votes this week" for a design = COUNT(*) WHERE votedAt >= week boundary.
--   * "designs I voted on this week" = rows WHERE voterUserId = me AND votedAt >= boundary.
-- The "once per week per design" limit is TIME-WINDOWED, so it is enforced in the service
-- layer (reject if a row for (voter, owner, entryKey, language) exists since the boundary),
-- NOT by a DB unique constraint — a UNIQUE here would block legitimate next-week votes.
--
-- Week boundary = most-recent Sunday 04:00 in the voter's local timezone, the SAME derivation
-- the wins/weeklies system uses (server/dal/shared/weekBoundary.ts).
--
-- Idempotent: safe to re-run (table + indexes guarded with IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS community_layout_votes (
    id            SERIAL PRIMARY KEY,
    "voterUserId" UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- who cast the vote
    "ownerUserId" UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the design's author
    "entryKey"    VARCHAR     NOT NULL,                                          -- the voted word (vet identity)
    language      VARCHAR(8)  NOT NULL,                                          -- 'zh' | 'es'
    "votedAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()                -- when the vote was cast
);

-- Per-design vote tally (the "top this week" ranking): group by the design identity, filter
-- votedAt by the week boundary.
CREATE INDEX IF NOT EXISTS idx_community_layout_votes_design
    ON community_layout_votes ("ownerUserId", "entryKey", language, "votedAt");

-- "Which designs did this voter vote on this week" (initial greying) + the once-a-week guard.
CREATE INDEX IF NOT EXISTS idx_community_layout_votes_voter
    ON community_layout_votes ("voterUserId", "votedAt");

COMMENT ON TABLE community_layout_votes
  IS 'Append-only upvote log for community-shared advanced card-icon layouts. A design = (ownerUserId, entryKey, language). One row per cast vote; "this week" = votedAt >= Sunday-04:00 boundary. Once-per-week limit enforced in the service layer, not by a unique constraint.';
