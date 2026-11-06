# Tower Style Shift (bento → tower)

The app is moving, gradually, from its **bento** look (flat pastel tiles and hairlined
cards on warm paper — [BENTO_SYSTEM.md](./BENTO_SYSTEM.md),
[SHELF_REDESIGN.md](./SHELF_REDESIGN.md)) to the **tower** look: the Deck Tower's
physical-object style, where a control or card reads as a thing in the iso scene
([DECK_TOWER.md](./DECK_TOWER.md), [ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md)).
This doc records which surfaces have moved, the rules that differ between the two styles,
and what is still bento. Update it whenever a surface switches.

The flp exists only inside the Deck Tower (`FlashcardsLearnPage`'s `tower: FlpTowerHost`
prop is required; there is no standalone flp route), so all flp styling is tower styling.

## The two styles

| | Bento (outgoing) | Tower (incoming) |
|---|---|---|
| Card | flat `fc.flashCard` face, 1px `COLORS.border` hairline, `SHADOW.cardRest` | cream rim + beige panel card stock, no hairline, no shadow when lying on the deck |
| Button | outlined pill / tile (CLAUDE.md "Buttons & cards") | a raised plate: face over a wall + contact shadow, presses flush (`towerPlate.ts`) |
| Edge | drawn by an outline | drawn by the object's own wall, rim or shadow |
| Colour source | theme palette (`theme.palette.flashcard`) and `RAMP` hue keys | fixed `COLORS` tokens; light comes from the scene's time-of-day wash, not the theme |

**The outline rule.** The CLAUDE.md "Buttons & cards" outline still applies to bento
surfaces: menu items, popover rows, sheets and lists. Tower objects are exempt because their
edge is physical: card stock, plates and the slab footer. Keep the exemption to things that
belong to the tower world; don't use it to drop outlines from bento surfaces.

## Card stock

Code: `src/features/flashcards/card/CardFace.tsx` → `CardFaceSide`;
`src/features/flashcards/card/cardStock.ts` → `cardStockVars`;
`src/features/flashcards/FlashcardsLearnPage/FlashCardSection.tsx` → `FLP_CARD_STOCK_VARS`;
`src/features/flashcards/VocabCardDetailPage.tsx` → `HERO_CARD_STOCK_VARS`;
`src/features/flashcards/constants.ts` →
`FLP_CARD_STOCK_INSET_RATIO`, `FLP_CARD_PANEL_RADIUS_RATIO`;
`src/features/deckTower/iso/IsoCard.tsx` → `FACE_PAD`, `PANEL_RADIUS`;
`src/cardIcons/CardIconLayer.tsx`, `src/cardIcons/editor/CardIconCanvas.tsx`
(`--card-panel-clip`); `src/cardIcons/cardTextLayout.ts` → `textBlockMaxWidth`.

The tower's card (IsoCard) is a cream top (`COLORS.cardFace`) with an inset beige printed
panel (`COLORS.cardBeige`) and beige / `COLORS.cardWall` walls. Both faces of every vet flashcard use that stock, so the card being studied looks
like the tower's own cards:

- **Rim.** The face fill is `COLORS.cardFace`. The panel sits `FLP_CARD_STOCK_INSET_RATIO`
  of the card's width in from each edge (= `FACE_PAD` 0.34 / `CARD_W` 4.8). Its corner
  (the rim's inner radius) is `FLP_CARD_PANEL_RADIUS_RATIO` (= IsoCard `PANEL_RADIUS` 0.24 /
  `CARD_W`): rounder than concentric with the card's 0.45 corner, which would leave a
  near-square 0.11, and equal to the head band's corner. Both values are set on
  the card frame as `--card-stock-inset` / `--card-panel-radius`, using the container-unit
  width that `--card-radius` already uses, so the rim scales with the card.
- **Panel.** `COLORS.cardBeige`, or the card's custom `cardColor` when the face renders the
  advanced layout. The custom colour fills the panel and the rim stays cream.
- **No hairline** (`CardFaceSide` → `border: "none"`). **No shadow on the flp**
  (`FlashCardSection` → `cardShadow` is `"none"`: the tower's cards lie flush). The cdp's
  hero wrapper keeps the resting `CARD_SURFACE.boxShadow`, since it lies on the page ground
  rather than on a deck.
- **Content stops at the panel.** `CardFaceSide`'s inner clip box takes `--card-panel-clip`,
  so icons, text and the sense chip are cut at the panel's edge, and text wraps at its width
  (`--card-panel-width`, `--card-stock-inset` padding on the front). The writing flp's face
  pads itself further by the rim plus `PANEL_CONTENT_GAP` (`insetPad`, never less than its
  plain-flp padding), so its rows sit a little in from the edge.
- **Not themed.** The tower is one lit scene in every theme. The flp card isn't washed at night either:
  the study layer's SVG wash filter was cut 2026-10-30 (DECK_TOWER.md § Time of day →
  "The wash").

Every vet card face is on this stock: `CardFaceSide` always prints it, and each card
FRAME supplies the rim's geometry through `cardStockVars(widthCss)` — the flp's card stack
(`FlashCardSection`) and the vet cdp's hero card (`VocabCardDetailPage`, at `100cqw`). There
is no bento flashcard face any more.

## The play slab

No game panel is in tower style. `GameFrame` (`src/games/shared/GameFrame.tsx`) has no
`tone` prop: its `"tower"` variant (a gold slab in the shades of `platformTone(COLORS.gld)`,
with tower-toned `GameHud` / `GameHudLabel` / `GameHint` / `GameTimer`) was removed after
Match Speed, its only user, went back to the bento panel (MATCH_SPEED_GAME.md).

What remains: `src/theme/towerSlab.ts` → `CREAM_PLATE_TONES` (read by the flp game break's
card, `GameBreakCard`) and `slabRim`. The gold slab tokens and the per-colour night wash
for DOM games are deleted. A future tower-toned game panel must wash colour by colour
(`timeOfDay/wash.ts` → `phaseWash`): an SVG or CSS filter over the DOM is what made the flp
lag at night.

## Surfaces already in tower style

| Surface | Where | Doc |
|---|---|---|
| Deck Tower scene (cards, plates, platform, lever, hatch) | `src/features/deckTower/` | DECK_TOWER.md, ISO_ART_FRAMEWORK.md |
| flp card stock and the vet cdp's hero card | `CardFaceSide` + `cardStockVars` | § Card stock above |
| flp page buttons: Write it, Compare, More Info | `src/theme/towerPlate.ts` → `towerPlateSx` | DECK_TOWER.md § "Studying the tower" → "The buttons" |
| flp game break's card (card stock, plates, glyph token) | `gameBreak/GameBreakCard.tsx`, `BreakCardLayer.tsx` | FLP_GAME_BREAKS.md § 5 |
| flp study header + audio chip | `TowerStudyHeader.tsx` (`tone="bare"`) | DECK_TOWER.md § "Studying the tower" → "The audio chip" |
| acp's on-deck cards, its skipped-cards sheet and td's cards page (rim + panel, drawn as one thick panel: a 4px wall and a near-solid cast shadow on the ground, no outline) | `src/features/discover/sortCardStock.ts` → `sortCardStockSx` | SORT_CARDS_REQUIREMENTS.md § 4.5, § 5.1a |
| td's cards page under the platform (the same stock on `MiniVocabCard` `stock`, with the mastery strip, no levitation; an own-colour card fills the panel via `--mini-card-panel`) | `src/features/deckTower/TowerCardsPage.tsx` → `TOWER_CARD_STOCK` | DECK_TOWER.md § "The cards page" |
| Slab footer (`footerStyle: "slab"` in `src/routes/routeMeta.ts`: `/` (td), `/dictionary`, both cdps, acp) | `src/components/MobileFooter.tsx` | DECK_TOWER.md § Footer |
| Tier 2 time-of-day ground (the page ground tints with the hour; the slab follows): `/dictionary`, both cdps | `src/timeOfDay/useTier2Look.ts` → `useTier2Look` | DECK_TOWER.md § Time of day |

## Still bento

Everything else: the Menu popover, the rest of acp, the cdp's body below
the hero card, the eip/sheets and every game page. When one of them moves, add a row to the table above and
say which bento rule it drops.
