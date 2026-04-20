-- Night Market unlocks: one row per unlocked item per user
-- Base-set items have unlockOrder=0; earned items have unlockOrder=1,2,3,...
CREATE TABLE IF NOT EXISTS nightmarketunlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "assetId" VARCHAR(100) NOT NULL,
  "unlockType" VARCHAR(20) NOT NULL DEFAULT 'stall',
  "unlockOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Prevent duplicate assets per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_nightmarketunlocks_user_asset
  ON nightmarketunlocks ("userId", "assetId");

-- Fast lookup of all unlocks for a user, ordered by unlock sequence
CREATE INDEX IF NOT EXISTS idx_nightmarketunlocks_user_order
  ON nightmarketunlocks ("userId", "unlockOrder");

COMMENT ON TABLE nightmarketunlocks
  IS 'Persists each user''s unlocked night market items. Base-set items have unlockOrder=0; earned items have unlockOrder=1,2,3,...';
