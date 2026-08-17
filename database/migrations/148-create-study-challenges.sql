-- Migration 148: Study Challenge — the weekly head-to-head between two friends.
--
-- See docs/STUDY_CHALLENGE.md (§ 9 is the signed-off data model, 2026-08-16).
--
-- NUMBERED 148, NOT 147. This was written as 147 on 2026-08-17 and renumbered the
-- same day: 147 had already been claimed by the compute_utcm_category drop (the
-- contract step of migration 143) AND applied to the dev database, which makes it
-- immutable per CLAUDE.md § "Migration number collisions". This file had reached no
-- database, so it was the one that moved.
--
-- ── ONE TABLE FOR THE WHOLE FEATURE ──────────────────────────────────────────
-- A challenge is a small, BOUNDED, self-contained object: exactly 2 players, 10
-- words each, 3 rounds each, one outcome, then it is finished forever. So the
-- word sets, the round scores and the generated deck ids all live on the
-- challenge as jsonb rather than being scattered across the vet and deck tables
-- as foreign bookkeeping (§ 9, Q52). Unbounded collections would still deserve
-- their own table; none of these is unbounded.
--
-- ── WHY THE WORDS ARE NOT A COLUMN ON THE VET TABLES ─────────────────────────
-- Two reasons that are not about style (§ 9):
--   1. A word can be contested in several live challenges at once, so a scalar
--      vet column cannot represent it -- it would have to become an ever-growing
--      array of challenge ids on the hottest table in the app.
--   2. A PENDING challenge has no vet rows yet. Words are only materialised on
--      accept (§ 3.3), and reviewing the not-yet-materialised set IS the
--      confirmation flow.
-- `words[].vocabEntryId` is therefore a CONVENIENCE POINTER, never an identity
-- and never a claim of membership. It may dangle, and the challenge does not
-- care: the challenge owns "which 10 words", the vet row owns "is it in the
-- user's library" (Q54). Word identity on the wire is the denormalised
-- (language, word1) pair, because det ids are not stable across data deploys
-- (Q49).
--
-- ── DIRECTION IS PERMANENT HERE (unlike `friendships`) ───────────────────────
-- `friendships` records direction but stops meaning it once accepted. A
-- challenge means it forever: only the challengee may accept or decline, only
-- the challenger may withdraw, and the history entry reads "you challenged Bob".
--
-- Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- study_challenges
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS study_challenges (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE: deleting an account takes its challenges with it (Q59), matching
  -- how `friendships` already treats a deleted account. This destroys the
  -- history for BOTH sides, which is accepted -- and it is why the maintenance
  -- job needs pass 4, the orphaned-preset-deck sweep: the surviving player's
  -- challenge deck outlives the row that named it, and users cannot delete a
  -- preset deck themselves (§ 4).
  "challengerId"        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "challengeeId"        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'same_word'      = one negotiated set of 10, used by both players
  -- 'different_word' = each player gets their own 10; may be cross-language (§ 8)
  -- Chosen by the challenger and stated in the invitation (Q29/Q62).
  variant               varchar(16) NOT NULL
                                    CHECK (variant IN ('same_word', 'different_word')),

  -- The challenger's ACTIVE language at issue time (Q38); there is no language
  -- picker in the invite flow. Equal to the challengee's unless the challenge is
  -- cross-language, which only 'different_word' permits (§ 8).
  -- Not CHECK-constrained, for the same reason `decks.language` is not: the
  -- app's language set grows and the write path already validates it.
  "challengerLanguage"  varchar(8)  NOT NULL,
  "challengeeLanguage"  varchar(8)  NOT NULL,

  -- pending    : issued, awaiting the challengee's Wednesday 04:00 local deadline
  -- accepted   : word sets agreed, decks created, test window ahead
  -- declined   : the challengee ended it explicitly (blocks the pair until the
  --              next Monday -- see the weekStart index below, which IS that block)
  -- expired    : the accept deadline passed with no answer. DISTINCT from
  --              no_contest (Q17): an expired challenge never had an agreed set
  --              and never created a deck
  -- complete   : both players played every round; `winnerUserId` is stamped
  --              (or left NULL for a draw, Q16)
  -- no_contest : the window closed with either player incomplete, or one player
  --              unfriended the other mid-flight (Q41). Not a forfeit -- a player
  --              who finished still sees their own score, but no winner is declared
  -- There is deliberately NO "accepted but unpicked" state: the challengee picks
  -- their words BEFORE the challenge is accepted, so the backend never holds a
  -- set-less accepted challenge (§ 8.2).
  status                varchar(16) NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'accepted', 'declined',
                                                      'expired', 'complete', 'no_contest')),

  -- The chosen games IN ORDER, drawn once at issue and shared by both players --
  -- a score comparison across different games is not a comparison (§ 5.1).
  --
  -- Each element is a {gameId, mode} PAIR, not a bare id: eligibility is per
  -- MODE, and Word Search qualifies only as Pinyin (its No-Pinyin mode is a
  -- reading game and is excluded). Shape: [{"gameId":"word-search","mode":"pinyin"}]
  --
  -- ⚠️ TIME-GATED VISIBILITY. Drawn at issue but NOT revealed until the
  -- requesting player's own test window opens (Q63). The serializer must OMIT
  -- this field before then -- a client that merely declines to render it still
  -- ships the answer to anyone who opens the network tab. This is the only field
  -- in the feature with such a rule.
  "gameSequence"        jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- EACH PLAYER'S 10 WORDS, keyed by user id, so one shape serves both variants
  -- and the results page never branches. A same-word challenge simply writes the
  -- same ten entries under both keys.
  --   { "<userId>": [{ "position": 1, "word1": "开始", "language": "zh",
  --                    "vocabEntryId": 90210 }, ... ] }
  -- `vocabEntryId` is filled in when the set is materialised on accept and is
  -- null before then (§ 9).
  words                 jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- EACH PLAYER'S PLAYED ROUNDS, keyed by user id then by round index:
  --   { "<userId>": { "1": { "gameId": "bubble-match", "mode": null,
  --                          "score": 820, "breakdown": {...},
  --                          "completedAt": "..." } } }
  -- `gameId` is stored per round even though it is derivable from
  -- `gameSequence`, so the history page's game filter does not have to correlate
  -- two arrays (§ 1).
  --
  -- ⚠️ EXACTLY ONE FUNCTION MAY EVER WRITE THIS COLUMN:
  -- StudyChallengeDAL.recordRound, as a single insert-only jsonb_set statement
  -- guarded by `rounds #> path IS NULL` (§ 9, Q53). Both players write this row,
  -- possibly at the same instant; one statement takes the row lock and does the
  -- read-modify-write inside it, so concurrent submissions serialise and neither
  -- is lost. The path guard enforces the one-attempt-per-round rule (Q40) in the
  -- same breath. DO NOT add a convenient read-modify-write helper in the service.
  rounds                jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- The generated ("preset") deck this challenge created per player, to drop on
  -- cleanup (§ 4):  { "<userId>": <deckId> }
  -- The pointer lives HERE rather than as a `challengeId` on `decks`, because a
  -- deck does not need to know why it exists.
  -- ⚠️ An id inside jsonb cannot carry a foreign key, so there is no CASCADE and
  -- a stale deck id is possible in principle. Tolerable: the only path that
  -- deletes a challenge deck is this feature's own cleanup (users cannot -- § 4),
  -- and a stale id resolving to nothing is a no-op on cleanup.
  "presetDeckIds"       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- The UTC anchor every local boundary is derived from. Boundaries are NEVER
  -- stored as pre-computed local timestamps: they are recomputed on every read
  -- from this anchor plus each user's CURRENT `users.timezone` (Q50), so a player
  -- who travels or fixes a wrong timezone immediately sees correct deadlines and
  -- no repair job is ever needed.
  "issuedAt"            timestamptz NOT NULL DEFAULT now(),

  -- ⚠️ NEW COLUMN, NOT IN THE SIGNED-OFF § 9 LIST -- see the index below for why
  -- it has to exist. The challenger's Monday 04:00 local, as a UTC instant.
  --
  -- Computed by the service at insert and never updated. It is deliberately NOT
  -- an index expression over ("issuedAt", timezone): resolving an IANA zone is
  -- not IMMUTABLE, so Postgres cannot index it. Snapshotting the week does not
  -- contradict Q50's "nothing about a player's zone is snapshotted" -- Q50 is
  -- about DEADLINES, which stay live. This is the challenge's identity (which
  -- week it belongs to), and identity must not move under a unique index.
  "weekStart"           timestamptz NOT NULL,

  "acceptedAt"          timestamptz,
  "completedAt"         timestamptz,

  -- NULL for a draw (Q16) and for no_contest (§ 6). Always one of the two
  -- players, so the CASCADE on their id already removes the row; SET NULL is
  -- belt-and-braces for the ordering of that cascade.
  "winnerUserId"        uuid        REFERENCES users(id) ON DELETE SET NULL,

  -- Challenging yourself is meaningless and would break the pair-key index (the
  -- row would collide with itself under LEAST/GREATEST).
  CONSTRAINT study_challenges_no_self CHECK ("challengerId" <> "challengeeId"),

  -- A winner must be one of the two players. Cheap guard against a service bug
  -- stamping a third party into a result nobody could explain later.
  CONSTRAINT study_challenges_winner_is_player
    CHECK ("winnerUserId" IS NULL
           OR "winnerUserId" IN ("challengerId", "challengeeId"))
);

-- ONE CHALLENGE PER UNORDERED PAIR PER WEEK (§ 1).
--
-- LEAST/GREATEST makes the key direction-blind, the same trick
-- `friendships_pair_uniq` uses, so Bob cannot counter-challenge Alice in a week
-- she already challenged him.
--
-- Two rules fall out of this ONE index, which is why it is worth the extra
-- column:
--   * the weekly pair limit itself; and
--   * the DECLINE COOLDOWN (§ 1) -- a declined row still occupies its
--     (pair, week) slot, so "declining blocks a new challenge to that pair until
--     the next Monday" needs no separate rate limiter. Withdrawing, by contrast,
--     DELETES the row (§ 1) and therefore frees the slot immediately, which is
--     exactly the stated behaviour.
--
-- Not partial: `expired` and `no_contest` rows must hold their slot too, or a
-- pair whose challenge expired on Wednesday could start another the same week.
CREATE UNIQUE INDEX IF NOT EXISTS study_challenges_pair_week_uniq
  ON study_challenges (
    LEAST("challengerId", "challengeeId"),
    GREATEST("challengerId", "challengeeId"),
    "weekStart"
  );

-- The challenges page reads "my live challenges", from whichever side the viewer
-- is on. Two single-column-leading indexes rather than one composite, because a
-- row is matched by an OR across the two columns and Postgres can use either --
-- the same shape `friendships` uses.
CREATE INDEX IF NOT EXISTS study_challenges_challenger_idx
  ON study_challenges ("challengerId", status);
CREATE INDEX IF NOT EXISTS study_challenges_challengee_idx
  ON study_challenges ("challengeeId", status);

-- The history log is keyset-paginated on "completedAt" DESC per user (§ 1), and
-- is deliberately NOT language-scoped. Partial, because only resolved challenges
-- are ever in the log and unresolved rows would otherwise bloat both indexes.
CREATE INDEX IF NOT EXISTS study_challenges_challenger_history_idx
  ON study_challenges ("challengerId", "completedAt" DESC)
  WHERE "completedAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS study_challenges_challengee_history_idx
  ON study_challenges ("challengeeId", "completedAt" DESC)
  WHERE "completedAt" IS NOT NULL;

-- The maintenance job's passes 1-3 scan by status across all users (every
-- pending row whose deadline has passed, every accepted row whose window has
-- closed). Partial on the two live statuses: the table only grows, and the job
-- must never pay for the resolved history it will never touch again.
CREATE INDEX IF NOT EXISTS study_challenges_live_status_idx
  ON study_challenges (status, "issuedAt")
  WHERE status IN ('pending', 'accepted');

-- ─────────────────────────────────────────────────────────────────────────────
-- decks."editMode" — what the user may DO to this deck (§ 4)
-- ─────────────────────────────────────────────────────────────────────────────
-- 'custom' = the user authored it: rename, delete, add and remove cards.
-- 'preset' = generated for them: no rename, no delete, no membership change, and
--            it does NOT count against MAX_DECKS_PER_LANGUAGE (100).
--
-- This describes what may be done to the deck, which is intrinsic to the deck --
-- unlike a `challengeId`, which would make `decks` learn about a foreign
-- feature. It also generalises past this feature: any future generated set (a
-- curated pack, a weakness drill) is 'preset' without a second flag.
--
-- DEFAULT 'custom' is the safe backfill -- every deck that exists today was
-- authored by its owner, so no existing deck changes behaviour.
ALTER TABLE decks
  ADD COLUMN IF NOT EXISTS "editMode" varchar(16) NOT NULL DEFAULT 'custom';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'decks_edit_mode_valid'
  ) THEN
    ALTER TABLE decks
      ADD CONSTRAINT decks_edit_mode_valid CHECK ("editMode" IN ('custom', 'preset'));
  END IF;
END $$;

-- THE NAME UNIQUENESS INDEX BECOMES PARTIAL (Q30, § 4).
--
-- Authored decks keep the guarantee for the reason migration 141 gave: two decks
-- called "Food" are indistinguishable in the add-to-deck checkbox menu. Generated
-- challenge decks are exempt because two live challenges against the same friend
-- must both be able to be called `vs Bob`, and they are safe to exempt precisely
-- because they never appear in that menu -- they cannot be added to, so there is
-- nothing to mistakenly tick. They are told apart by the friend's icon on the tile.
DROP INDEX IF EXISTS decks_user_language_name_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS decks_user_language_name_uniq
  ON decks ("userId", language, lower(btrim(name)))
  WHERE "editMode" = 'custom';

-- The /decks payload reads the user's preset decks as their own section (the
-- fifth, placed immediately above the user's own Decks section), so it filters
-- on this column; the 100-deck cap counts with the opposite filter.
CREATE INDEX IF NOT EXISTS decks_user_language_edit_mode_idx
  ON decks ("userId", language, "editMode");

-- ─────────────────────────────────────────────────────────────────────────────
-- friendships — the per-pair challenge opt-out (§ 1, Q46)
-- ─────────────────────────────────────────────────────────────────────────────
-- "No challenges with this friend". TWO booleans, one per endpoint, matching the
-- table's existing requesterId/addresseeId endpoints.
--
-- OWNERSHIP IS SPLIT, THE EFFECT IS SYMMETRIC. Each player may only ever set or
-- clear THEIR OWN flag, so a blocked person cannot unblock themselves and
-- somebody who blocks is never silently unblocked by the other party changing
-- their mind. The READ is `NOT (requester OR addressee)` -- a challenge goes
-- through only if NEITHER has blocked -- and that OR is where the symmetry
-- lives. Setting a block therefore stops your own outgoing challenges as well as
-- their incoming ones: it means "I do not want to play challenges with this
-- person", which is the honest reading of opting out of a mutual commitment.
--
-- They belong on `friendships` because a block is a property of the
-- RELATIONSHIP, not of either user.
--
-- Two columns rather than one nullable "blockedBy", because they are two
-- independent facts held by two people and both can be true at once.
--
-- Setting the block mid-challenge only blocks NEW challenges; the in-flight one
-- plays out (Q57). Unfriending remains the hard exit.
ALTER TABLE friendships
  ADD COLUMN IF NOT EXISTS "requesterChallengesBlocked" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "addresseeChallengesBlocked" boolean NOT NULL DEFAULT false;
