-- Migration 182: delete the win / personal-best history of the removed Review and
-- Challenge study modes.
--
-- See docs/DEFERRED_WORK.md § 31. The flp and Match Speed each offered three modes —
-- Study Mix, Review (Comfortable + Mastered only) and Challenge (Unfamiliar + Target
-- only). Review and Challenge were removed 2026-11-04; Study Mix is the only mode left.
-- The history they wrote is deleted rather than kept unread (owner's decision,
-- 2026-11-04): nothing can display it any more, and a lifetime win total or a "best"
-- that silently includes runs of a mode the player can no longer choose would mislead.
--
-- WHAT IS DELETED (Match Speed only — the flp never wrote either table):
--
--   wins                 game = 'matchSpeed' AND level IN ('2', '3')
--                        `matchSpeed` is the client's GAME_KEY
--                        (src/games/match-speed/constants.ts). Each mode logged a gold
--                        run under its own `winLevel`: Study Mix 1, Review 2,
--                        Challenge 3. Level 1 is untouched — it is the key the game used
--                        before it had modes and the one Study Mix still writes
--                        (WIN_LEVEL). `level` is varchar (migration 78), hence the
--                        quoted values.
--                        NOT touched: `bubbleMatch` levels 2/3 — Bubble Match's own
--                        difficulty levels, unrelated to study modes.
--
--   game_personal_bests  game IN ('match-speed-30', 'match-speed')
--                        AND mode IN ('review', 'challenge')
--                        `mode` held the Match Speed mode slug
--                        (`usePersonalBest("match-speed-30", mode)`). 'match-speed' is the
--                        legacy pair-count key from the old 30-second game
--                        (server/contracts/personalBests.ts → PERSONAL_BEST_GAMES), which
--                        recorded under the same slugs. Restricted to these two game ids
--                        so a 'challenge' mode key any other game might use is never
--                        caught. Study Mix's 'mixed' rows stay.
--
-- ORDERING: plain auto-run. The client that stops writing these rows ships in the same
-- deploy, and the delete is idempotent, so a straggler row written by a stale client
-- bundle between this migration and the rebuild is harmless — it is unreadable by the
-- new client, and re-running this file's DELETEs by hand would clear it.
--
-- Dev counts at authoring time (2026-11-04): 0 rows matched in either table.
--
-- NO OWN TRANSACTION: migrate.sh wraps each file in one.

DELETE FROM wins
 WHERE game = 'matchSpeed'
   AND level IN ('2', '3');

DELETE FROM game_personal_bests
 WHERE game IN ('match-speed-30', 'match-speed')
   AND mode IN ('review', 'challenge');
