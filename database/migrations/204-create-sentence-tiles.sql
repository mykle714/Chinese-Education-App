-- Migration 204: Sentence Tiles — two-player correspondence word-tile game judged by AI.
--
-- Design: docs/SENTENCE_TILES_GAME.md § "Data model" (all four tables approved by the owner
-- 2026-11-22). Code: server/dal/implementations/SentenceTilesDAL.ts,
-- server/services/SentenceTilesService.ts, server/contracts/sentenceTiles.ts.
--
-- sentence_tile_games — one row per game between two friends. The challenger (playerA) plays
--   the opening move when they create it; the opponent's first turn is the accept. Racks and
--   the bag live here as jsonb and are NEVER sent whole to a client: the service strips the
--   bag and the opponent's rack from every read. `version` bumps on every state change and is
--   what the client's heartbeat poll compares. `judgeStartedAt` marks an AI judge call in
--   flight so a second concurrent submission for the same game is refused instead of paying
--   for a second call.
--
-- sentence_tile_moves — the move log: plays, exchanges, passes, resignations, and rejected
--   attempts (kind 'rejected': a line the judge refused; the turn does not pass). The
--   per-turn rejected-attempt cap counts rows of that kind for the current turn.
--
-- sentence_tile_verdicts — every AI verdict, keyed by (language, line). Two jobs: the cache
--   (an identical line is never judged twice, which also makes rulings consistent) and the
--   training log for the future in-house scorer (docs/BACKLOG.md § 10).
--
-- sentence_tile_judge_usage — completed judge calls per player per local streak-day; the
--   per-player daily cap is enforced by a conditional upsert-increment on this row.
--
-- Per-user data: NOT on /data-ppe-to-dev's pull list.
-- Additive: safe to auto-run by migrate.sh ahead of the new code (old code never reads it).

CREATE TABLE IF NOT EXISTS sentence_tile_games (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    language            varchar(10) NOT NULL DEFAULT 'zh',
    -- The challenger, who plays the opening move.
    "playerAId"         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "playerBId"         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- draft: created, challenger has not moved yet · pending: challenger moved, awaiting accept
    -- active: opponent accepted by moving · finished · declined · cancelled (challenger withdrew)
    status              varchar(12) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'pending', 'active', 'finished', 'declined', 'cancelled')),
    -- Whose turn it is; NULL once the game is over.
    "turnUserId"        uuid        REFERENCES users(id) ON DELETE SET NULL,
    -- [{ row, col, tileId, word, turn }] — every tile on the board.
    board               jsonb       NOT NULL DEFAULT '[]'::jsonb,
    -- [{ id, word }] — each player's rack.
    "rackA"             jsonb       NOT NULL DEFAULT '[]'::jsonb,
    "rackB"             jsonb       NOT NULL DEFAULT '[]'::jsonb,
    -- [{ id, word }] — the undrawn tiles, already shuffled; draws pop from the end.
    bag                 jsonb       NOT NULL DEFAULT '[]'::jsonb,
    "scoreA"            integer     NOT NULL DEFAULT 0,
    "scoreB"            integer     NOT NULL DEFAULT 0,
    -- Consecutive turns that scored nothing (pass / exchange); 4 ends the game.
    "scorelessTurns"    integer     NOT NULL DEFAULT 0,
    -- Bumped on every state change; the heartbeat poll answers 204 while it is unchanged.
    version             integer     NOT NULL DEFAULT 1,
    -- Set while an AI judge call for this game is in flight; stale after 60 s.
    "judgeStartedAt"    timestamptz,
    -- NULL on a draw or an unfinished game.
    "winnerId"          uuid        REFERENCES users(id) ON DELETE SET NULL,
    "createdAt"         timestamptz NOT NULL DEFAULT now(),
    "updatedAt"         timestamptz NOT NULL DEFAULT now(),
    "finishedAt"        timestamptz,
    CHECK ("playerAId" <> "playerBId")
);

-- "My games" list and the active-games cap both scan by player.
CREATE INDEX IF NOT EXISTS sentence_tile_games_player_a_idx ON sentence_tile_games ("playerAId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS sentence_tile_games_player_b_idx ON sentence_tile_games ("playerBId", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS sentence_tile_moves (
    id                  bigserial   PRIMARY KEY,
    "gameId"            uuid        NOT NULL REFERENCES sentence_tile_games(id) ON DELETE CASCADE,
    "userId"            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 1-based turn the move belongs to. A rejected attempt carries the turn it was tried on.
    "turnNumber"        integer     NOT NULL,
    kind                varchar(10) NOT NULL
                        CHECK (kind IN ('play', 'exchange', 'pass', 'resign', 'rejected')),
    -- play / rejected: [{ tileId, row, col, word }]; exchange: [{ tileId, word }]; else NULL.
    placements          jsonb,
    -- play / rejected: the judged line's words in reading order.
    "lineWords"         text[],
    points              integer     NOT NULL DEFAULT 0,
    "createdAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sentence_tile_moves_game_idx ON sentence_tile_moves ("gameId", id);

CREATE TABLE IF NOT EXISTS sentence_tile_verdicts (
    id                  bigserial   PRIMARY KEY,
    language            varchar(10) NOT NULL,
    -- The line's words joined with '|' in reading order (tiles are indivisible units).
    line                text        NOT NULL,
    legal               boolean     NOT NULL,
    -- One short English sentence from the judge, shown to the player on a rejection.
    reason              text,
    model               varchar(64) NOT NULL,
    "requestedBy"       uuid        REFERENCES users(id) ON DELETE SET NULL,
    "createdAt"         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (language, line)
);

-- The global 24-hour call ceiling counts recent verdicts.
CREATE INDEX IF NOT EXISTS sentence_tile_verdicts_created_idx ON sentence_tile_verdicts ("createdAt");

CREATE TABLE IF NOT EXISTS sentence_tile_judge_usage (
    "userId"            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The player's local 04:00-bounded streak-day (utils → streakDateOf), as the dictionary cap uses.
    "usageDate"         date        NOT NULL,
    count               integer     NOT NULL DEFAULT 0,
    PRIMARY KEY ("userId", "usageDate")
);

COMMENT ON TABLE sentence_tile_games IS
    'Sentence Tiles: one two-player correspondence game. Bag and racks are server-only. Migration 204, docs/SENTENCE_TILES_GAME.md.';
COMMENT ON TABLE sentence_tile_moves IS
    'Sentence Tiles: move log, including judge-rejected attempts. Migration 204, docs/SENTENCE_TILES_GAME.md.';
COMMENT ON TABLE sentence_tile_verdicts IS
    'Sentence Tiles: AI judge verdict per line — cache and training log for the future scorer. Migration 204, docs/SENTENCE_TILES_GAME.md.';
COMMENT ON TABLE sentence_tile_judge_usage IS
    'Sentence Tiles: completed AI judge calls per player per local day (daily cap). Migration 204, docs/SENTENCE_TILES_GAME.md.';
