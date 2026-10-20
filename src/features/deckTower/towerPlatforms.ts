import { RIM_WIDTH, insetRect, leverFootprint, type PawnRoam, type WallSliderLayout, type WorldRect } from "./iso";

/**
 * towerPlatforms.ts — the Deck Tower's platform and the layout of everything on it
 * (docs/DECK_TOWER.md § "Scene").
 *
 * Layer: page constants (feature module `src/features/deckTower`). Pure geometry — no
 * React, no colour. Every world (towerWorlds.ts) stands the SAME platform in the same
 * spot; only its colours change. DeckTowerPage fits its viewBox to this layout and
 * DeckTowerPlatform.tsx draws it.
 */

/** The platform's slab. Its top surface is the floor, z = 0. It floats (IsoLevitate). */
export const PLATFORM: WorldRect = { x: 0, y: 0, w: 11, d: 11, r: 0.9 };
export const PLATFORM_THICKNESS = 1.5;

/** The platform's top: the towers and the pawns stand on it. */
export const FLOOR_Z = 0;
/** The sky's ground plane, below the platform — it receives the platform's shadow. */
export const GROUND_Z = -PLATFORM_THICKNESS - 1.6;

/** The card footprint — portrait, long side along world y. Centred on the platform. */
export const CARD_W = 4.8;
export const CARD_D = 6.6;
const CARD: WorldRect = {
    x: PLATFORM.x + (PLATFORM.w - CARD_W) / 2,
    y: PLATFORM.y + (PLATFORM.d - CARD_D) / 2,
    w: CARD_W,
    d: CARD_D,
    r: 0.45,
};

/**
 * The deck's name plate, printed on the floor in front of the tower (the strip between
 * the stack's front-left face and the platform edge), as wide as the card. It names the
 * deck while a tall tower's top card is scrolled off screen, and it is the deck switch:
 * tapping it swaps the world's tower to its other deck (towerDecks.ts).
 * It is part of the floor — a floor decal, not an obstacle — so pawns walk over it,
 * stepping up onto the slightly raised push button (DeckTowerPlatform → `plateStep`).
 */
const LABEL_PLATE: WorldRect = { x: CARD.x, y: CARD.y + CARD_D + 0.5, w: CARD_W, d: 1.1, r: 0.25 };

/**
 * The Mix / Review switch (IsoWallSlider), on the platform's FRONT-LEFT wall (its yMax
 * face — the lower-left wall on screen, under the floor plate): a slot and a label plate
 * side by side, centred along the wall and on its height. The knob's slot comes first
 * (upper-left), so Mix is the knob's near end and Review its far end
 * (docs/DECK_TOWER.md § "Mix / Review switch").
 */
const SWITCH_SLOT_W = 2.0;
const SWITCH_GAP = 0.35;
const SWITCH_LABEL_W = 3.1;
const SWITCH_X = PLATFORM.x + (PLATFORM.w - (SWITCH_SLOT_W + SWITCH_GAP + SWITCH_LABEL_W)) / 2;
const MODE_SWITCH: WallSliderLayout = {
    wallY: PLATFORM.y + PLATFORM.d,
    z: -PLATFORM_THICKNESS / 2,
    slotX: SWITCH_X,
    slotW: SWITCH_SLOT_W,
    labelX: SWITCH_X + SWITCH_SLOT_W + SWITCH_GAP,
    labelW: SWITCH_LABEL_W,
};

/**
 * The focus lever's hatch centre (IsoLever, docs/FOCUS_MODE.md § 5): the back-right corner
 * of the floor, beside the tower. Far enough off the tower's back-right corner (~1.5 units
 * diagonally) that the pawn — 1.2 units wide with its clearance — can still walk round the
 * tower past it.
 */
const LEVER_AT = { x: 9.85, y: 1.2 };

/** Where the pawn starts, front-right of the tower. From there it wanders (`roam`). */
const PAWN_AT = { x: 9.55, y: 7.5 };

export interface TowerPlatformLayout {
    platform: WorldRect;
    /** The tower's footprint. */
    card: WorldRect;
    labelPlate: WorldRect;
    /** The plate's tap target: the plate grown on every side (the print is only ~18 px deep on a phone). */
    labelPlateHit: WorldRect;
    /** The Mix / Review switch on the front-left wall. */
    modeSwitch: WallSliderLayout;
    /** The focus lever's hatch centre. Its hatch is an obstacle in `roam`. */
    leverAt: { x: number; y: number };
    pawnAt: { x: number; y: number };
    /**
     * Where the pawn may wander: the floor inside the platform's rim, around the tower.
     * The plate is NOT an obstacle — the pawn steps up onto it (IsoPawn `steps`). Obstacles are listed in
     * BACK-TO-FRONT draw order (the pawn reports its slot among them, `depthRankAmong`).
     */
    roam: PawnRoam;
}

export const TOWER_LAYOUT: TowerPlatformLayout = {
    platform: PLATFORM,
    card: CARD,
    labelPlate: LABEL_PLATE,
    labelPlateHit: insetRect(LABEL_PLATE, -0.5),
    modeSwitch: MODE_SWITCH,
    leverAt: LEVER_AT,
    pawnAt: PAWN_AT,
    // Back to front: the tower, then the lever's hatch (in front of the tower's
    // right-hand face, so it draws after the stack).
    roam: { area: insetRect(PLATFORM, RIM_WIDTH), obstacles: [CARD, leverFootprint(LEVER_AT)] },
};
