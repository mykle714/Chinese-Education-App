-- Migration 149: drop the write-only lifetime counters
--                vet."totalMarkCount" / vet."totalCorrectCount"
--
-- ⚠️ EXPAND/CONTRACT — THIS IS THE CONTRACT STEP. The code that stopped writing these
-- two columns must be DEPLOYED BEFORE this file runs, or every flashcard mark and undo
-- errors on a missing column. The standard /deploy order already satisfies this: the
-- deploy block runs `docker-compose up --build -d` (new code) BEFORE the migration
-- commands, so no runbook is needed — just do not run this file against a prod box that
-- has not been rebuilt from this commit.
--
-- WHY THEY EXISTED
-- Migration 16 added "totalMarkCount" (cumulative marks, correct + incorrect) and
-- migration 17 added "totalCorrectCount" (lifetime correct). They were the durable
-- counterpart to the ROLLING mark window: markHistory (later typedMarkHistory) keeps
-- only the last 8 marks per type, deliberately, so it cannot answer "how many times has
-- this learner been tested on this card, ever". These two could.
--
-- WHY THEY ARE DEAD
-- Their only consumers were the three success-rate columns added by the same migration
-- 17 — "totalSuccessRate" (defined literally as totalCorrectCount / totalMarkCount),
-- "last8SuccessRate" and "last16SuccessRate". Migration 101 dropped all three as part of
-- the mastery rework and explicitly KEPT the two raw counters. Nothing ever picked them
-- up again, so since 101 they have been strictly write-only:
--   * no query sorts, filters, aggregates or joins on either column;
--   * no service or DAL derives anything from them;
--   * the client never reads them — zero references in src/, despite VocabEntry in
--     server/contracts/wire.ts having declared both as optional fields (also removed);
--   * their four original indexes (idx_vocabentries_total_mark_count,
--     idx_vocabentries_total_correct_count, and the two success-rate ones) no longer
--     exist — they did not survive migration 66's per-language table split.
-- Three write sites maintained them for nothing: the mark route, the undo route (with a
-- Math.max(0, …) floor), and VocabEntryDAL.updateTypedMarkHistory.
--
-- EFFECT ON DATA — ⚠️ THIS IS A ONE-WAY DOOR
-- The lifetime tallies are DESTROYED and cannot be reconstructed. typedMarkHistory holds
-- only the last 8 marks per type, so "this card has been marked 37 times" is
-- unrecoverable the moment these columns go. Accepted deliberately: nothing reads the
-- numbers today, and there are no real customers whose history is being discarded (the
-- same reasoning migration 101 used when it discarded markHistory outright). If a
-- lifetime-effort statistic is ever wanted, it starts counting from zero at that point.
--
-- WHY DROP RATHER THAN LEAVE THEM ACCUMULATING
-- A column that is written on every single mark and read by nothing is worse than dead
-- weight: it reads as live state. The open design question of whether these should
-- become PER-MARK-TYPE counters (docs/DEFERRED_WORK.md) only existed because the columns
-- were there — with no reader, the honest answer is that neither shape is needed yet.
-- Deleting them turns a standing schema decision into a non-question, and a future
-- per-type counter can be designed against a real requirement instead of inheriting an
-- accidental all-type shape from 2024.
--
-- ROLLBACK
-- Re-add as nullable integers defaulting to 0 — the schema is trivially restorable even
-- though the VALUES are not:
--   ALTER TABLE vocabentries_zh ADD COLUMN "totalMarkCount" INTEGER DEFAULT 0,
--                               ADD COLUMN "totalCorrectCount" INTEGER DEFAULT 0;
--   (likewise vocabentries_es)
-- Every row would restart at 0.
--
-- Idempotent (IF EXISTS on all four drops).

ALTER TABLE vocabentries_zh
    DROP COLUMN IF EXISTS "totalMarkCount",
    DROP COLUMN IF EXISTS "totalCorrectCount";

ALTER TABLE vocabentries_es
    DROP COLUMN IF EXISTS "totalMarkCount",
    DROP COLUMN IF EXISTS "totalCorrectCount";
