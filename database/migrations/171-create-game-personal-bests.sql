-- Migration 171: create game_personal_bests — one best result per (user, language, game, mode)
--
-- WHY (docs/WRITING_PRACTICE_REWORK.md § 2a): every game shows a personal best on its
-- end screen, per mode. Approved 2026-10-04. Bubble Match has none (its performance
-- has a floor and a ceiling, so a best would saturate) and Memory Map has none.
--
-- STATE, NOT HISTORY: one row per (userId, language, game, mode), overwritten only when
-- a run beats it. `bestValue` is ms for time games (lower is better) or a count for
-- score games (higher is better); which direction a game uses is a constant in
-- server/contracts/personalBests.ts, NOT a column, so a row cannot disagree with its game.
--
-- Separate from `wins` on purpose: `wins` only gets a row on a win/medal, so a best set
-- on a no-medal run would be lost there.
--
-- Expand-only: no shipped code reads this table before the code that ships with it.

CREATE TABLE IF NOT EXISTS game_personal_bests (
  id            SERIAL      PRIMARY KEY,
  "userId"      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language      VARCHAR(8)  NOT NULL,
  game          VARCHAR(32) NOT NULL,   -- registry game id, e.g. 'word-search'
  mode          VARCHAR(32) NOT NULL,   -- the game's mode/level key, e.g. 'pinyin', '2'
  "bestValue"   INTEGER     NOT NULL,   -- ms (time games) or a count (score games)
  "achievedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_personal_bests_identity
  ON game_personal_bests ("userId", language, game, mode);

COMMENT ON TABLE game_personal_bests IS
  'Best result per (user, language, game, mode). bestValue = ms or count; direction per game in server/contracts/personalBests.ts. See docs/WRITING_PRACTICE_REWORK.md § 2a';
