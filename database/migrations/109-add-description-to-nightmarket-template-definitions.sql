-- Migration 109: Night Market template DESCRIPTION
--
-- Adds an optional, human-authored description to the validator template catalog
-- (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md). Shown in the editor's Load dropdown
-- alongside the author so a validator can tell templates apart at a glance.
--
-- Scope: the description is SHARED PER NAME, owned by version 0 — exactly like the
-- board size and the placeholder mask. It is authored only on version 0; higher
-- versions leave this column NULL and the service merges version 0's value in on
-- read. (A scalar column, not part of the `definition` JSONB, so the per-name Load
-- list can SELECT it directly — mirroring how name/width/height are lifted out.)

ALTER TABLE nightmarkettemplatedefinitions
    ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN nightmarkettemplatedefinitions.description IS
    'Optional author-written description of the template. Shared per name (authored on version 0; NULL on higher versions, merged from version 0 on read). See docs/NIGHT_MARKET_TEMPLATE_EDITOR.md.';
