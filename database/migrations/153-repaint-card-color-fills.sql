-- Migration 153: remap stored per-card fills onto the repainted palette.
--
-- Context: the 2026-08-22 app-wide token repaint moved the pastel accent family from
-- saturated BODY hues to near-white TINTS (src/theme/colors.ts). The fie card-fill
-- swatch row (src/utils/cardColor.ts → CARD_COLOR_OPTIONS) is built FROM those tokens,
-- so its offered values moved with them, while the server's allow-list
-- (server/contracts/wire.ts → CARD_COLOR_VALUES) held the old hexes.
--
-- Why a data migration and not just an allow-list edit: vet."cardColor" stores the raw
-- hex, and the client's resolveCardColor() returns `undefined` for any value not in the
-- offered palette — i.e. an un-remapped old hex would silently drop that card back to
-- the theme default with no error anywhere. The allow-list is only consulted on WRITE,
-- so the rows would sit there looking valid while rendering wrong.
--
-- Mapping (old BODY hue → new TINT), one row per swatch. beige/white/black are
-- unchanged by the repaint and so are absent.
--   grey   #D8D8DC → #E7E7EA
--   red    #F2BAC9 → #FFF2F2
--   green  #BAF2D8 → #F0FAF0
--   blue   #BAD7F2 → #EEF8FF
--   yellow #F2E2BA → #FFF5EA
--   purple #D8BAF2 → #F8F4FF
--
-- Applies to both vet tables (the only two carrying the column). Idempotent: the new
-- hexes are disjoint from the old ones, so a second run matches nothing.
--
-- Expand-only and order-independent: old code renders the new hexes as raw CSS just
-- fine (it never re-validates on read), so this may run before or after the rebuild.

UPDATE vocabentries_zh SET "cardColor" = m.new
FROM (VALUES
  ('#D8D8DC', '#E7E7EA'),
  ('#F2BAC9', '#FFF2F2'),
  ('#BAF2D8', '#F0FAF0'),
  ('#BAD7F2', '#EEF8FF'),
  ('#F2E2BA', '#FFF5EA'),
  ('#D8BAF2', '#F8F4FF')
) AS m(old, new)
WHERE vocabentries_zh."cardColor" = m.old;

UPDATE vocabentries_es SET "cardColor" = m.new
FROM (VALUES
  ('#D8D8DC', '#E7E7EA'),
  ('#F2BAC9', '#FFF2F2'),
  ('#BAF2D8', '#F0FAF0'),
  ('#BAD7F2', '#EEF8FF'),
  ('#F2E2BA', '#FFF5EA'),
  ('#D8BAF2', '#F8F4FF')
) AS m(old, new)
WHERE vocabentries_es."cardColor" = m.old;
