-- Games framework: shared asset table + per-user save state.
-- Asset registry is partitioned by gameId; each game owns its own slice.
CREATE TABLE IF NOT EXISTS gameassets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "gameId" VARCHAR(64) NOT NULL,
  "assetId" VARCHAR(100) NOT NULL,
  "displayName" VARCHAR(200),
  "imagePath" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gameassets_game_asset
  ON gameassets ("gameId", "assetId");

CREATE INDEX IF NOT EXISTS idx_gameassets_game
  ON gameassets ("gameId");

COMMENT ON TABLE gameassets
  IS 'Per-game asset registry. Image paths are served from server/public/games/<gameId>/.';

-- Per-user save state. One row per (user, game); state is game-defined JSON.
CREATE TABLE IF NOT EXISTS gameprogress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "gameId" VARCHAR(64) NOT NULL,
  "state" JSONB NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gameprogress_user_game
  ON gameprogress ("userId", "gameId");

COMMENT ON TABLE gameprogress
  IS 'Per-user save blob for each game. Schema of state column is defined by each game.';
