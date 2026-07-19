-- Migration 117: add a per-placement LOCK to the Night Market template sandbox.
--
-- A template author can LOCK a placed sandbox tile so it can no longer be dragged/moved
-- (docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md). This is a move-guard only — a locked tile can still
-- be selected, version-switched, and deleted. Persisted so the lock survives reloads, like the
-- rest of the sandbox layout.
--
-- Additive + idempotent: NOT NULL DEFAULT false, so every existing placement is unlocked.

ALTER TABLE nightmarkettemplatesandbox
    ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN nightmarkettemplatesandbox.locked IS
    'When true, this sandbox placement cannot be dragged/moved (a move-guard only; selecting, version-switching, and deleting still work). See docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md.';
