-- Hourly Study Challenge maintenance (prod only).
--
-- See docs/STUDY_CHALLENGE.md § 9 "The maintenance job" and
-- docs/STREAK_EXPIRATION_CRON.md (the unit this runs as a third ExecStart step of).
--
-- WHY THIS FILE EXISTS AT ALL: several of the feature's transitions are
-- TIME-TRIGGERED rather than user-triggered. Nobody taps a button when an accept
-- deadline passes or a test window closes, so without this job a pending challenge
-- never lapses and an accepted one never resolves. Everything else in the feature is
-- driven by a request; these four passes are the whole of what is not.
--
-- HOURLY IS THE RIGHT GRANULARITY, not a compromise: every boundary is 04:00 local,
-- so exactly one timezone crosses each boundary per hour. Running more often would
-- find nothing new; running daily would leave a challenge resolved up to a day late.
--
-- ── THE BOUNDARY ARITHMETIC MUST MATCH server/shared/challengeWeek.ts ─────────
-- Both this file and that module answer "when is this player's Wednesday/Monday
-- 04:00", and if they ever disagree the visible symptom is ugly: a player is shown a
-- deadline the server has already acted on, or an Accept button that 500s. The shared
-- rule, applied identically in both places (`weekBoundary` there):
--
--     take the week's MONDAY DATE, add N days, take 04:00 in THAT PLAYER'S
--     timezone, convert back to UTC.
--
-- The week's Monday date is derived from the stored COUNTER (migration 150):
--
--     monday(weekIndex) = DATE '2026-01-05' + 7 * "weekIndex"
--
-- ⚠️ THE EPOCH IS DUPLICATED — it is `CHALLENGE_WEEK_EPOCH_UTC` in
-- server/shared/challengeWeek.ts and `DATE '2026-01-05'` here and in migration 150.
-- Change one alone and every deadline in this file moves by a week.
--
-- This replaced `(weekStart AT TIME ZONE tz)::date + N`. The old column was the
-- CHALLENGER's Monday 04:00 as an instant, so in a distant zone it landed on the
-- challengee's Sunday or Tuesday and each player's local date had to be re-read to
-- recover "the Monday". A counter names the Monday directly, in every zone, with no
-- conversion — which is also why the pair-week unique index now actually fires.
--
--     accept deadline  = monday + 2 days at 04:00, CHALLENGEE's tz
--     test window ends = monday + 7 days at 04:00, EACH player's tz
--
-- ── FOUR PASSES, AND THE ORDER MATTERS ───────────────────────────────────────
--   1. expire unaccepted invitations
--   2. close finished windows (complete / no_contest, stamping the winner)
--   3. drop preset decks whose owner's window has closed
--   4. sweep preset decks no surviving challenge claims
-- Each later pass consumes what an earlier one leaves behind: pass 3 drops the decks
-- of challenges pass 2 has just resolved, and pass 4 is the backstop for decks whose
-- challenge row is gone entirely.
--
-- EVERY PASS IS IDEMPOTENT, because the unit is `Persistent=true` and a tick missed
-- to a reboot re-runs. Passes 1–3 filter on the status they are leaving; pass 4 is
-- idempotent because a deleted deck simply stops matching.
--
-- NOT HERE, deliberately: the drop of a deck when its owner FINISHES the test. That
-- one happens synchronously in StudyChallengeService.submitRound, because it should
-- be immediate rather than up to an hour late.
--
-- Logging: each pass raises a NOTICE only when it did something, so an idle tick
-- prints just BEGIN / DO / COMMIT.

BEGIN;

DO $$
DECLARE
  expired_count   integer := 0;
  completed_count integer := 0;
  nocontest_count integer := 0;
  decks_dropped   integer := 0;
  orphans_swept   integer := 0;
BEGIN

  -- ───────────────────────────────────────────────────────────────────────────
  -- PASS 1 — expire unaccepted invitations.
  --
  -- `status = 'pending'` past the CHALLENGEE's Wednesday 04:00. No decks exist yet
  -- (they are created in the accept transaction), so there is nothing else to clean
  -- up. `completedAt` is stamped even though nothing was played: it is the history
  -- log's sort key, and a resolved row with a null key would silently vanish from the
  -- log.
  --
  -- `expired` is DISTINCT from `no_contest` on purpose: an expired challenge never
  -- had a word set both players agreed to.
  -- ───────────────────────────────────────────────────────────────────────────
  WITH due AS (
    SELECT sc.id
      FROM study_challenges sc
      JOIN users ce ON ce.id = sc."challengeeId"
     WHERE sc.status = 'pending'
       AND now() >= (
             (((DATE '2026-01-05' + 7 * sc."weekIndex" + 2)
               + TIME '04:00') AT TIME ZONE COALESCE(ce.timezone, 'UTC'))
           )
  ), updated AS (
    UPDATE study_challenges sc
       SET status = 'expired', "completedAt" = now()
      FROM due
     WHERE sc.id = due.id AND sc.status = 'pending'
     RETURNING sc.id
  )
  SELECT count(*) INTO expired_count FROM updated;

  IF expired_count > 0 THEN
    RAISE NOTICE '[study-challenges] expired % unaccepted invitation(s)', expired_count;
  END IF;

  -- ───────────────────────────────────────────────────────────────────────────
  -- PASS 2 — close finished windows.
  --
  -- `status = 'accepted'` past the LATER of the two players' Monday 04:00. The later
  -- of the two is what stops a player in an eastern timezone from timing their
  -- opponent out — nobody is ever resolved on somebody else's clock.
  --
  -- Then, per challenge:
  --   * both players played every round -> 'complete', winner = higher total, or NULL
  --     for a draw (a plain draw, no hidden tiebreak);
  --   * otherwise                       -> 'no_contest', winner NULL. Not a forfeit:
  --     a player who finished still sees their own score, but no winner is declared.
  --
  -- ROUND COUNT COMES FROM THE CHALLENGE'S OWN `gameSequence`, never from a hard-coded
  -- 3. A cross-language pair legitimately plays two rounds, and comparing their round
  -- count against 3 would mark every such challenge no_contest forever.
  --
  -- Totals are summed from the stored per-round scores and are NOT clamped — a total
  -- may legitimately be negative.
  -- ───────────────────────────────────────────────────────────────────────────
  WITH closed AS (
    SELECT sc.id,
           sc."challengerId",
           sc."challengeeId",
           -- LEAST(...) of the sequence length and 3 mirrors CHALLENGE_ROUND_COUNT:
           -- the sequence is drawn at that cap, but reading the cap here too means a
           -- future cap change cannot leave old rows unresolvable.
           LEAST(COALESCE(jsonb_array_length(sc."gameSequence"), 0), 3) AS round_count,
           (SELECT count(*) FROM jsonb_object_keys(COALESCE(sc.rounds -> sc."challengerId"::text, '{}'::jsonb))) AS cr_rounds,
           (SELECT count(*) FROM jsonb_object_keys(COALESCE(sc.rounds -> sc."challengeeId"::text, '{}'::jsonb))) AS ce_rounds,
           (SELECT COALESCE(SUM((v ->> 'score')::numeric), 0)
              FROM jsonb_each(COALESCE(sc.rounds -> sc."challengerId"::text, '{}'::jsonb)) AS e(k, v)) AS cr_total,
           (SELECT COALESCE(SUM((v ->> 'score')::numeric), 0)
              FROM jsonb_each(COALESCE(sc.rounds -> sc."challengeeId"::text, '{}'::jsonb)) AS e(k, v)) AS ce_total
      FROM study_challenges sc
      JOIN users cr ON cr.id = sc."challengerId"
      JOIN users ce ON ce.id = sc."challengeeId"
     WHERE sc.status = 'accepted'
       AND now() >= GREATEST(
             (((DATE '2026-01-05' + 7 * sc."weekIndex" + 7)
               + TIME '04:00') AT TIME ZONE COALESCE(cr.timezone, 'UTC')),
             (((DATE '2026-01-05' + 7 * sc."weekIndex" + 7)
               + TIME '04:00') AT TIME ZONE COALESCE(ce.timezone, 'UTC'))
           )
  ), resolved AS (
    UPDATE study_challenges sc
       SET status = CASE
                      WHEN c.round_count > 0
                       AND c.cr_rounds >= c.round_count
                       AND c.ce_rounds >= c.round_count THEN 'complete'
                      ELSE 'no_contest'
                    END,
           "winnerUserId" = CASE
                              WHEN c.round_count > 0
                               AND c.cr_rounds >= c.round_count
                               AND c.ce_rounds >= c.round_count
                               AND c.cr_total <> c.ce_total
                                THEN CASE WHEN c.cr_total > c.ce_total
                                          THEN c."challengerId" ELSE c."challengeeId" END
                              ELSE NULL
                            END,
           "completedAt" = now()
      FROM closed c
     WHERE sc.id = c.id AND sc.status = 'accepted'
     RETURNING sc.id, sc.status
  )
  SELECT count(*) FILTER (WHERE status = 'complete'),
         count(*) FILTER (WHERE status = 'no_contest')
    INTO completed_count, nocontest_count
    FROM resolved;

  IF completed_count > 0 OR nocontest_count > 0 THEN
    RAISE NOTICE '[study-challenges] closed % window(s): % complete, % no contest',
      completed_count + nocontest_count, completed_count, nocontest_count;
  END IF;

  -- ───────────────────────────────────────────────────────────────────────────
  -- PASS 3 — drop preset decks whose owner's window has closed.
  --
  -- PER PLAYER, on that player's OWN clock: Alice's deck can go while Bob's window is
  -- still open. That falls out of the rule rather than being a special case — the deck
  -- is a personal study aid, not shared state.
  --
  -- The pointer is removed from `presetDeckIds` in the same statement pair, so the
  -- column only ever names decks that exist and pass 4 has nothing left to find.
  -- Nothing of value is lost: deleting a deck never deletes a card or a mark, and the
  -- word set itself lives on the challenge row forever.
  -- ───────────────────────────────────────────────────────────────────────────
  WITH due AS (
    SELECT sc.id AS challenge_id,
           (e.key)::uuid AS player_id,
           (e.value)::text::integer AS deck_id
      FROM study_challenges sc
      CROSS JOIN LATERAL jsonb_each(COALESCE(sc."presetDeckIds", '{}'::jsonb)) AS e(key, value)
      JOIN users u ON u.id = (e.key)::uuid
     WHERE now() >= (
             (((DATE '2026-01-05' + 7 * sc."weekIndex" + 7)
               + TIME '04:00') AT TIME ZONE COALESCE(u.timezone, 'UTC'))
           )
  ), deleted AS (
    -- `"editMode" = 'preset'` is asserted even though the id came from a challenge:
    -- an id inside jsonb carries no foreign key, so this is the only thing standing
    -- between a corrupted pointer and a user's own deck.
    DELETE FROM decks d
     USING due
     WHERE d.id = due.deck_id
       AND d."userId" = due.player_id
       AND d."editMode" = 'preset'
     RETURNING d.id, due.challenge_id, due.player_id
  ), cleared AS (
    UPDATE study_challenges sc
       SET "presetDeckIds" = sc."presetDeckIds" - deleted.player_id::text
      FROM deleted
     WHERE sc.id = deleted.challenge_id
     RETURNING sc.id
  )
  SELECT count(*) INTO decks_dropped FROM cleared;

  IF decks_dropped > 0 THEN
    RAISE NOTICE '[study-challenges] dropped % challenge deck(s) at window close', decks_dropped;
  END IF;

  -- ───────────────────────────────────────────────────────────────────────────
  -- PASS 4 — sweep orphaned preset decks.
  --
  -- WHY THIS EXISTS: deleting an account CASCADEs its challenge rows away, which
  -- destroys the only record of which decks belonged to them — while the SURVIVING
  -- player's challenge deck lives on, and they cannot delete it themselves (a preset
  -- deck exposes no delete control). Without this sweep it sits on their /decks page
  -- forever. It also backstops any future path that drops a challenge without its
  -- decks, so it is a genuine backstop rather than a fix for one bug.
  --
  -- ⚠️ THIS IS THE ONE PASS THAT COULD DELETE A DECK IT SHOULD NOT, because it is
  -- defined NEGATIVELY ("no challenge claims this"). Two safeguards, both mandatory:
  --
  --   * it matches on `"editMode" = 'preset'` FIRST, so a user's own deck can never be
  --     a candidate no matter what the challenge table says; and
  --   * it ignores decks younger than one hour, so a deck created in the window
  --     between the deck insert and the `presetDeckIds` write is never swept. That
  --     window does not actually exist today — StudyChallengeService writes both in
  --     ONE transaction — so this is belt-and-braces, and it is cheap.
  -- ───────────────────────────────────────────────────────────────────────────
  WITH swept AS (
    DELETE FROM decks d
     WHERE d."editMode" = 'preset'
       AND d."createdAt" < now() - INTERVAL '1 hour'
       AND NOT EXISTS (
             SELECT 1
               FROM study_challenges sc
              CROSS JOIN LATERAL jsonb_each(COALESCE(sc."presetDeckIds", '{}'::jsonb)) AS e(key, value)
              WHERE (e.value)::text::integer = d.id
           )
     RETURNING d.id
  )
  SELECT count(*) INTO orphans_swept FROM swept;

  IF orphans_swept > 0 THEN
    RAISE NOTICE '[study-challenges] swept % orphaned challenge deck(s)', orphans_swept;
  END IF;

END $$;

COMMIT;
