-- Migration 206: drop the generic games-framework tables, and delete the stored rows of
-- the three archived games (Bubble Match, Hydra Bubbles, Bucket Drop).
--
-- Owner's decision, 2026-11-23 (dead-code sweep):
--
--   1. `gameassets` / `gameprogress` (migration 52) backed the game-agnostic
--      `GET /api/games/:gameId/assets` and `GET|POST /api/games/:gameId/progress`
--      routes. No client ever called them, so the routes, GamesController,
--      GameAssetService/GameProgressService and their DALs were deleted. Both tables
--      were empty on dev and PPE when this was written.
--
--   2. Bubble Match, Hydra Bubbles and Bucket Drop were archived to the git branch
--      `archive/bubble-match-hydra-bucket-drop` (docs/ARCHIVED_FEATURES.md). Their
--      stored results are deleted rather than kept as inert history, by decision:
--        wins                 keyed by the camelCase game key the client logged
--                             ('bubbleMatch', 'hydraBubbles', 'bucketDrop')
--                             — PPE had 82 'bubbleMatch' rows
--        game_personal_bests  keyed by the game slug
--                             ('bubble-match', 'hydra-bubbles', 'bucket-drop')
--                             — PPE had 1 'bucket-drop' row
--      NOT touched: `study_challenges."gameSequence"` / rounds JSON that name one of
--      these games (Study Challenge is flagged off; the client renders such a round as
--      unplayable — src/games/runtime/challengeLaunch.ts → challengeLaunchFor).
--
-- DEPLOY ORDER: safe under the standard /deploy (code up, then migrations). The new code
-- reads none of these tables or rows. Run before the new code, it would only break the
-- callerless /api/games/:gameId/* routes. The row deletes are order-independent: the
-- archived games had no reachable entry point on PPE, so nothing writes new rows.
--
-- Verification (expect 0, then 0, then 0):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name IN ('gameassets', 'gameprogress');
--   SELECT count(*) FROM wins WHERE game IN ('bubbleMatch', 'hydraBubbles', 'bucketDrop');
--   SELECT count(*) FROM game_personal_bests
--    WHERE game IN ('bubble-match', 'hydra-bubbles', 'bucket-drop');
--
-- Idempotent: safe to re-run.

BEGIN;

DROP TABLE IF EXISTS gameprogress;
DROP TABLE IF EXISTS gameassets;

DELETE FROM wins WHERE game IN ('bubbleMatch', 'hydraBubbles', 'bucketDrop');
DELETE FROM game_personal_bests WHERE game IN ('bubble-match', 'hydra-bubbles', 'bucket-drop');

COMMIT;
