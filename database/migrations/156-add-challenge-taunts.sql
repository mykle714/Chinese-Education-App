-- Migration 156: challenge taunts — one canned line a player may send after a
-- completed challenge, shown on the results screen.
--
-- See docs/STUDY_CHALLENGE.md § 6a and design F17/F17b.
--
-- ── Why one jsonb keyed by user id, not two text columns ─────────────────────
-- `study_challenges` already stores `words`, `rounds` and `presetDeckIds` as
-- `{ "<userId>": ... }`, precisely so no read path has to branch on which side of
-- the challenge the requesting player is. The results screen draws one card per
-- player from exactly that shape; a `"challengerTaunt"` / `"challengeeTaunt"` pair
-- would have made the taunt the ONLY per-player field on the table that needs an
-- `isChallenger` branch to read, and every future consumer would have to rediscover
-- which column is whose.
--
-- ── Keyed by SENDER, not by target ───────────────────────────────────────────
-- The screen shows a taunt on the card of whoever it is AIMED at, so keying by
-- target would have matched the rendering more directly. Sender wins because it is
-- the durable fact and because it makes "one taunt per player" a property of the
-- object's own shape rather than a rule some write path has to remember. The target
-- is the other key, always, and there are only ever two.
--
-- ── No free text ─────────────────────────────────────────────────────────────
-- `tauntId` is a key into a server-owned list of canned lines
-- (server/contracts/wire.ts -> CHALLENGE_TAUNTS), NOT the line itself. Three
-- consequences, all of them the point:
--   * nothing a user typed is ever stored or shown to another user, so the feature
--     needs no moderation, no reporting path and no abuse review;
--   * the wording can be revised later without a data migration;
--   * an unknown id (a line retired in a newer build) degrades to no taunt rather
--     than to a blank speech bubble.
--
-- Shape:
--   { "<userId>": { "tauntId": "eight-of-nine", "sentAt": "2026-09-01T12:00:00Z" } }
--
-- NOT NULL DEFAULT '{}' rather than nullable: every other keyed-by-user column on
-- this table is a total function of the two players, and an absent key already means
-- "did not send". A nullable column would add a second way to say the same thing.

ALTER TABLE study_challenges
  ADD COLUMN IF NOT EXISTS taunts jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN study_challenges.taunts IS
  'userId -> {tauntId, sentAt}. The SENDER is the key; the taunt renders on the other player''s results card. tauntId indexes CHALLENGE_TAUNTS in server/contracts/wire.ts, never free text.';
