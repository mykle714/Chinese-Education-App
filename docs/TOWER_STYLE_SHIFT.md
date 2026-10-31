# Tower Style Shift (bento → tower)

The app is moving, gradually, from its **bento** look (flat pastel tiles and hairlined
cards on warm paper — [BENTO_SYSTEM.md](./BENTO_SYSTEM.md),
[SHELF_REDESIGN.md](./SHELF_REDESIGN.md)) to the **tower** look: the Deck Tower's
physical-object style, where a control or card reads as a thing in the iso scene
([DECK_TOWER.md](./DECK_TOWER.md), [ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md)).
This doc records which surfaces have moved, the rules that differ between the two styles,
and what is still bento. Update it whenever a surface switches.

**Direction (2026-10-26):** the tower-hosted flp (`FlashcardsLearnPage` with a `tower`
host) is the app's one flp. The routed `/flashcards/learn` is legacy and kept only for its
remaining entry points ([DEFERRED_WORK.md](./DEFERRED_WORK.md) #25). New flp styling goes
on the tower path first.

## The two styles

| | Bento (outgoing) | Tower (incoming) |
|---|---|---|
| Card | flat `fc.flashCard` face, 1px `COLORS.border` hairline, `SHADOW.cardRest` | cream rim + beige panel card stock, no hairline, no shadow when lying on the deck |
| Button | outlined pill / tile (CLAUDE.md "Buttons & cards") | a raised plate: face over a wall + contact shadow, presses flush (`towerPlate.ts`) |
| Edge | drawn by an outline | drawn by the object's own wall, rim or shadow |
| Colour source | theme palette (`theme.palette.flashcard`) and `RAMP` hue keys | fixed `COLORS` tokens; light comes from the scene's time-of-day wash, not the theme |

**The outline rule.** The CLAUDE.md "Buttons & cards" outline still applies to bento
surfaces: menu items, hub tiles, sheets and lists. Tower objects are exempt because their
edge is physical: card stock, plates and the slab footer. Keep the exemption to things that
belong to the tower world; don't use it to drop outlines from bento surfaces.

## Card stock

Code: `src/features/flashcards/card/CardFace.tsx` → `CardFaceSide` (`towerStock`);
`src/features/flashcards/FlashcardsLearnPage/FlashCardSection.tsx` → `TOWER_STOCK_VARS`,
FlashCard `towerStock`; `src/features/flashcards/constants.ts` →
`FLP_CARD_STOCK_INSET_RATIO`, `FLP_CARD_PANEL_RADIUS_RATIO`;
`src/features/deckTower/iso/IsoCard.tsx` → `FACE_PAD`, `PANEL_RADIUS`;
`src/cardIcons/CardIconLayer.tsx`, `src/cardIcons/editor/CardIconCanvas.tsx`
(`--card-panel-clip`); `src/cardIcons/cardTextLayout.ts` → `textBlockMaxWidth`.

The tower's card (IsoCard) is a cream top (`COLORS.cardFace`) with an inset beige printed
panel (`COLORS.cardBeige`) and beige / `COLORS.cardWall` walls. On the tower-hosted flp,
both faces of every card use that stock, so the card being studied looks like the tower's
own cards:

- **Rim.** The face fill is `COLORS.cardFace`. The panel sits `FLP_CARD_STOCK_INSET_RATIO`
  of the card's width in from each edge (= `FACE_PAD` 0.34 / `CARD_W` 4.8). Its corner
  (the rim's inner radius) is `FLP_CARD_PANEL_RADIUS_RATIO` (= IsoCard `PANEL_RADIUS` 0.24 /
  `CARD_W`): rounder than concentric with the card's 0.45 corner, which would leave a
  near-square 0.11, and equal to the head band's corner. Both values are set on
  the card frame as `--card-stock-inset` / `--card-panel-radius`, using the container-unit
  width that `--card-radius` already uses, so the rim scales with the card.
- **Panel.** `COLORS.cardBeige`, or the card's custom `cardColor` when the face renders the
  advanced layout. The custom colour fills the panel and the rim stays cream.
- **No hairline, no shadow.** The tower's cards have neither.
- **Content stops at the panel.** `CardFaceSide`'s inner clip box takes `--card-panel-clip`,
  so icons, text and the sense chip are cut at the panel's edge, and text wraps at its width
  (`--card-panel-width`, `--card-stock-inset` padding on the front). The writing flp's face
  pads itself further by the rim plus `PANEL_CONTENT_GAP` (`insetPad`, never less than its
  plain-flp padding), so its rows sit a little in from the edge.
- **Not themed.** The tower is one lit scene in every theme. The flp card isn't washed at night either:
  the study layer's SVG wash filter was cut 2026-10-30 (DECK_TOWER.md § Time of day →
  "The wash").

Only the tower-hosted flp sets `towerStock`. The routed flp, the cdp hero card and
`ReadingSwipeGrid` keep the bento face.

## The play slab

Code: `src/theme/towerSlab.ts` → `TOWER_SLAB`, `CREAM_PLATE_TONES`;
`src/games/shared/GameFrame.tsx` → `GameFrameTone`.

No game uses the slab today: Match Speed, its only user, moved to § Ground paint. `tone="tower"`
is kept for the next tower-toned game, and `TOWER_SLAB` still colours the plates.

A game's panel in tower style is the tower's floating platform, flat from above:
`GameFrame tone="tower"` draws a gold slab (`TOWER_SLAB`, the shades of
`platformTone(COLORS.gld)`) with a light bevel and a wall as thick as the tower platform (`TOWER_SLAB_WALL_PX`). Its strips lose their tint
and hairline, labels take the plate's print, the clock's track is a groove, and a break's
Leave is a cream plate. Gold rather than the game's blue because the break floats in the
tower's `bluMk` sky, where a blue panel would vanish.

- **Fixed gold.** The slab does not follow the reading or writing world's platform colour,
  because a game on its own route has no world.
- **Night.** The game takes the tower's wash colour by colour (`src/timeOfDay/useDayWash.ts`:
  `useDayWash` at the Stage, `useTowerWash` in each part, `TowerWashContext` between them). It
  must stay per colour: an SVG or CSS filter over the DOM is what made the flp lag at night.
  Ink, and the flp card a grow starts from, are not washed.
- **Grow plate.** `FlpBreakGame.panelFill` is what the break card turns into as it grows, so
  each game's plate lands on its own panel colour. Null means the game has no panel (§ Ground
  paint) and the card fades where it is.

## Ground paint

Code: `src/theme/groundPaint.ts` → `GROUND_PAINT`, `GROUND_PRINT`, `GROUND_PAINT_FAINT`;
`src/games/shared/GameFrame.tsx` → `GameFrameTone` `"ground"`; `src/games/match-speed/`.

The lightest tower surface: nothing but the look of Tap to Start
(`src/features/deckTower/TapToStartHint.tsx`), flat white on the ground in regular weight, with no plate,
wall, shadow or panel. Washed like every other tower colour. `GameFrame tone="ground"` draws
no box, and its strips and labels turn to paint. Buttons do not: a card and Leave are white
with the app's `COLORS.border` outline, ink type. State replaces a
button's white (MATCH_SPEED_GAME.md § Card visual states).

The paint needs a mid-tone ground: the sky, or a hue's Mark tier. It vanishes on a Mid tier or
on paper. `GROUND_PRINT` and `GROUND_PAINT` are not read by `TapToStartHint`, which paints SVG
through the iso palette; retune the two together.

Still bento inside a tower-toned game: `ChallengeRoundScoreboard`, `GamePausedOverlay`,
`ProvisionalSortOffer` and `ProvisionalCardsNotice`, which every game shares.

## Surfaces already in tower style

| Surface | Where | Doc |
|---|---|---|
| Deck Tower scene (cards, plates, platform, lever, hatch) | `src/features/deckTower/` | DECK_TOWER.md, ISO_ART_FRAMEWORK.md |
| flp card stock (tower-hosted) | `CardFaceSide` `towerStock` | § Card stock above |
| flp page buttons: Write it, Compare, More Info (tower-hosted) | `src/theme/towerPlate.ts` → `towerPlateSx` | DECK_TOWER.md § "Studying the tower" → "The buttons" |
| flp game break's card (card stock, plates, glyph token) | `gameBreak/GameBreakCard.tsx`, `BreakCardLayer.tsx` | FLP_GAME_BREAKS.md § 5 |
| Match Speed play surface: ground paint on the sky, end popup, plates | `GameFrame tone="ground"`, `src/games/match-speed/` | § Ground paint, MATCH_SPEED_GAME.md § Rendering a card |
| flp study header + audio chip (tower-hosted) | `TowerStudyHeader.tsx` (`tone="bare"`) | DECK_TOWER.md § "Studying the tower" → "The audio chip" |
| scp's on-deck cards (rim + panel; keeps the hairline ring, adds a 2px wall and a flat cast shadow on the page ground) | `SortCardsPage.tsx` → `sortCardStockSx` | SORT_CARDS_REQUIREMENTS.md § 4.5 |
| Slab footer (`footerStyle: "slab"`: `/deck-tower`, the Dictionary tab, scp) | `src/components/MobileFooter.tsx` | DECK_TOWER.md § Footer |

## Still bento

Everything else: the hp Menu bento, the Games hub, the rest of scp, the cdp, the eip/sheets, the
routed flp and every game page except Match Speed's play surface (its page header and blue
ground stay). When one of them moves, add a row to the table above and
say which bento rule it drops.
