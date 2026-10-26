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
(`--card-icon-clip`).

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
- **Icons are clipped to the panel** (`--card-icon-clip`). Text is not, so it may cross the rim.
- **Not themed.** The tower is one lit scene in every theme; the page's study wash filter
  supplies time-of-day light.

Only the tower-hosted flp sets `towerStock`. The routed flp, the cdp hero card and
`ReadingSwipeGrid` keep the bento face.

## Surfaces already in tower style

| Surface | Where | Doc |
|---|---|---|
| Deck Tower scene (cards, plates, platform, lever, hatch) | `src/features/deckTower/` | DECK_TOWER.md, ISO_ART_FRAMEWORK.md |
| flp card stock (tower-hosted) | `CardFaceSide` `towerStock` | § Card stock above |
| flp page buttons: Write it, Compare, More Info (tower-hosted) | `towerPlate.ts` → `towerPlateSx` | DECK_TOWER.md § "Studying the tower" → "The buttons" |
| flp study header + audio chip (tower-hosted) | `TowerStudyHeader.tsx` (`tone="bare"`) | DECK_TOWER.md § "Studying the tower" → "The audio chip" |
| Slab footer (`footerStyle: "slab"`, today only `/deck-tower`) | `src/components/MobileFooter.tsx` | DECK_TOWER.md § Footer |

## Still bento

Everything else: the hp Menu bento, the Games hub, scp, the cdp, the eip/sheets, the
routed flp and every game page. When one of them moves, add a row to the table above and
say which bento rule it drops.
