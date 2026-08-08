-- Migration 137: Create the `category_promotions` table — the event log behind VELOCITY.
--
-- Velocity = how many utcm band-steps a user climbed in the last 7 days, per
-- (user, language). See docs/VELOCITY.md.
--
-- WHY A LOG AND NOT A COUNTER (or a derived query):
-- A card's utcm category is NOT stored anywhere. It is computed on read from
-- `typedMarkHistory` + the account's goal flags (migration 101,
-- compute_utcm_category / server/contracts/mastery.ts). Nothing in the schema
-- records that a card MOVED between bands, and the 8-slot per-type mark window
-- discards the marks that would let us reconstruct it. So a promotion is only
-- observable at the instant it happens — inside POST /api/flashcards/mark, which
-- already computes the category on both sides of the mark. This table is that
-- observation, appended.
--
-- Consequence: velocity is NOT backfillable. Every account starts at 0 and the
-- number becomes meaningful after ~7 days of use.
--
-- COUNTING RULE: velocity sums "bandsClimbed", not rows. One card climbing two
-- bands counts the same as two cards climbing one band each. A single mark CAN
-- cross two bands at once (the pbh blend is continuous), which is why the step
-- count is stored per row rather than assumed to be 1.
--
-- WHAT IS NOT LOGGED:
--   * Demotions. Velocity only measures upward movement (a wrong mark can push a
--     card back down a band; that is not subtracted).
--   * Goal-flag toggles. Turning on the reading/writing goal re-bands EVERY card
--     at once without any review happening — that is a re-scoring of past work,
--     not work done this week, so it writes no rows.
--
-- vocabEntryId has NO foreign key: vet is split per language (vocabentries_zh /
-- vocabentries_es share one id sequence), so the referent lives in one of two
-- tables and Postgres cannot express that. Rows are cleaned up via "userId"
-- CASCADE; an orphan row from a deleted card is harmless (velocity is a count,
-- and it ages out of the 7-day window anyway).
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS category_promotions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Language of the promoted card, so velocity is per-(user, language) like
  -- minute points, wallets and streaks (migration 130).
  language        varchar(10) NOT NULL,
  -- vet id. Globally unique across vocabentries_zh / vocabentries_es.
  "vocabEntryId"  integer     NOT NULL,
  -- The utcm bands either side of the transition (Unfamiliar/Target/Comfortable/Mastered).
  "fromCategory"  varchar(16) NOT NULL,
  "toCategory"    varchar(16) NOT NULL,
  -- rank(toCategory) - rank(fromCategory). Always >= 1: only promotions are logged.
  "bandsClimbed"  smallint    NOT NULL CHECK ("bandsClimbed" > 0),
  -- Which mastery track the causing mark landed in (recognition/production/reading/writing).
  "markType"      varchar(16) NOT NULL,
  -- The causing ReviewMark's timestamp. undoLastMark deletes by (vocabEntryId,
  -- markTimestamp) so an undone mark takes its promotion with it exactly.
  "markTimestamp" timestamptz NOT NULL,
  "promotedAt"    timestamptz NOT NULL DEFAULT now()
);

-- The velocity query: one user, one language, inside the sliding 7-day window.
CREATE INDEX IF NOT EXISTS idx_category_promotions_user_lang_at
  ON category_promotions("userId", language, "promotedAt");
-- The undo lookup: delete the rows one specific mark created.
CREATE INDEX IF NOT EXISTS idx_category_promotions_entry_mark
  ON category_promotions("vocabEntryId", "markTimestamp");

COMMENT ON TABLE category_promotions IS
  'Append-only log of utcm band promotions (one row per upward category move). Velocity = SUM("bandsClimbed") per (userId, language) over the last 7 days. Written only by POST /api/flashcards/mark; removed by undoLastMark. Not backfillable — category is a derived value with no history. See docs/VELOCITY.md.';
COMMENT ON COLUMN category_promotions."bandsClimbed" IS
  'Number of utcm bands climbed by this single transition (>=1). A mark can cross two bands at once, so velocity sums this rather than counting rows.';
COMMENT ON COLUMN category_promotions."markTimestamp" IS
  'Timestamp of the ReviewMark that caused the promotion; the key undoLastMark deletes by.';
