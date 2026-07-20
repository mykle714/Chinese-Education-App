-- Migration 118: add a generic per-placement SETTINGS bag to the Night Market template sandbox.
--
-- The sandbox keeps growing small per-tile view/render switches (the first is "render a house in
-- EVERY placeholder area of this template, or none"). Rather than add a boolean column per
-- switch, every such author-facing knob now lives in ONE jsonb bag so future settings need no
-- migration. Structural facts that the server reasons about (offsets, activeVersion, locked)
-- stay as real columns — only render/view preferences belong in `settings`.
--
-- Current keys (see server/types/nightMarket.ts → TemplateSandboxSettings):
--   showHouses : boolean — render an occupant house in every placeholder area of this placement
--                (absent = true, the default look).
--
-- Additive + idempotent: NOT NULL DEFAULT '{}', so every existing placement gets the defaults.

ALTER TABLE nightmarkettemplatesandbox
    ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN nightmarkettemplatesandbox.settings IS
    'Per-placement RENDER/VIEW preference bag (jsonb). Keys are validated by NightMarketSandboxService.cleanSettings; unknown keys are rejected. Current: showHouses (boolean, absent = true). See docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md.';
