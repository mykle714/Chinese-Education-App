// Surface recipes — small groups of tokens that must travel TOGETHER because they
// describe one physical object rather than one property.
//
// Depended on by: docs/SHELF_REDESIGN.md (D2/D13), docs/BENTO_SYSTEM.md (the tile look).

import { COLORS } from "./colors";
import { SHADOW } from "./shadows";

/**
 * The corner radius of a CARD-SIZED surface (~the width of a flashcard face or a
 * Mastery Center tile). Exported as a number as well as through `CARD_SURFACE` because
 * several places have to clip children to the same curve — the card's inner clip box,
 * the icon layer, the fie canvas — and a mismatch there shows as a hairline of icon
 * poking past the corner.
 */
export const CARD_SURFACE_RADIUS = 15;

/**
 * A CARD LYING ON THE PAGE — the app's one recipe for "this box is a card".
 *
 * Three properties, and they only work as a set: the hairline gives the card an EDGE
 * (without it a pale card on the warm paper ground has no boundary), the shadow gives it
 * a height, and the radius gives it its size class. Used by the Decks page's Mastery
 * Center tiles and hand cards, the flp flashcard, and the cdp hero card, so those four
 * read as the same kind of object.
 *
 * A card that is being HELD — the flp's front/flying card, the hand's front card — keeps
 * this border and radius but overrides `boxShadow` with a higher one; only the resting
 * elevation belongs to the recipe.
 */
export const CARD_SURFACE = {
    border: `1px solid ${COLORS.border}`,
    borderRadius: `${CARD_SURFACE_RADIUS}px`,
    boxShadow: SHADOW.cardRest,
} as const;
