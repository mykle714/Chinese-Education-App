-- Migration 77: Add `avatarIconId` to the `users` table
--
-- Lets a user pick one of the downloaded icons8 icons (migration 71) as their
-- profile avatar. The value references the icons8 natural key `icons8Id`, exactly
-- like det."iconId" does (migration 72) — the avatar is rendered client-side via the
-- existing public image endpoint GET /api/icons8/<id>/image.
--
-- Nullable: users have no avatar until they choose one (the UI falls back to the
-- name-initial Avatar).
--
-- ON DELETE SET NULL: if an icon row is ever removed from icons8, referencing users
-- simply lose their avatar (avatarIconId -> NULL) rather than blocking the delete.
--
-- Idempotent: safe to re-run.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "avatarIconId" TEXT;

-- FK added separately so the migration stays idempotent (ADD COLUMN IF NOT EXISTS
-- can't carry a named constraint that survives a clean re-run).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_avatar_icon'
    ) THEN
        ALTER TABLE users
          ADD CONSTRAINT fk_users_avatar_icon
          FOREIGN KEY ("avatarIconId") REFERENCES icons8("icons8Id") ON DELETE SET NULL;
    END IF;
END $$;

-- Index the FK column: keeps the ON DELETE SET NULL sweep cheap when an icon row
-- is removed (avoids a full users scan to find referencing rows).
CREATE INDEX IF NOT EXISTS idx_users_avatar_icon_id ON users("avatarIconId");

COMMENT ON COLUMN users."avatarIconId" IS
  'Optional FK to icons8("icons8Id"): the icon the user picked as their profile avatar, rendered via GET /api/icons8/<id>/image. NULL = no avatar (UI falls back to name initial). ON DELETE SET NULL.';
