import { RIM_WIDTH, insetRect, leverFootprint, modeSwitchFootprint, type PawnRoam, type WorldRect } from "./iso";

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
 * The Mix / Review switch (IsoModeSwitch): a small light-switch block in its own hatch at the
 * floor's RIGHT corner on screen (high x, low y), beside the tower's back-right face. It
 * shows only the current mode's name, on its paddle. Like the lever it stands only while the
 * Learn Now deck is up (docs/DECK_TOWER.md § "Mix / Review switch").
 *
 * Its 1.6 × 2.7 hatch spans x 9.15 – 10.75 and y 0.55 – 3.25: inside the rim (0.16 – 10.84)
 * and the floor's rounded corner, and clear of the pawn's start (y 7.5). It overlaps the
 * tower only along y 2.2 – 3.25, so the pawn still walks the strip between the tower and the
 * right edge as far as the switch; it cannot squeeze past the switch's ends (the gaps, grown
 * by the pawn's 0.6, close), so it reaches the back of the tower round the other side.
 */
const MODE_SWITCH_AT = { x: 9.95, y: 1.9 };

/**
 * The focus lever's hatch centre (IsoLever, docs/FOCUS_MODE.md § 5): the LEFT corner of the
 * floor on screen (low x, high y — the platform's back-right corner mirrored across the
 * screen), beside the near end of the floor plate. Far enough off the tower's front-left
 * corner (~1.5 units diagonally) that the pawn — 1.2 units wide with its clearance — can
 * still walk round the tower past it.
 */
const LEVER_AT = { x: 1.2, y: 9.85 };

/** Where the pawn starts, front-right of the tower. From there it wanders (`roam`). */
const PAWN_AT = { x: 9.55, y: 7.5 };

export interface TowerPlatformLayout {
    platform: WorldRect;
    /** The tower's footprint. */
    card: WorldRect;
    labelPlate: WorldRect;
    /** The plate's tap target: the plate grown on every side (the print is only ~18 px deep on a phone). */
    labelPlateHit: WorldRect;
    /** The Mix / Review switch's hatch centre (the crease of its V). Its hatch is an obstacle in `roam`. */
    modeSwitchAt: { x: number; y: number };
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
    modeSwitchAt: MODE_SWITCH_AT,
    leverAt: LEVER_AT,
    pawnAt: PAWN_AT,
    // Back to front: the tower, then the lever's hatch (wholly in front of the tower's
    // front-left face) and the switch's (wholly in front of its back-right face), so both
    // draw after the stack. The two hatches never overlap on screen, so their order is free.
    roam: { area: insetRect(PLATFORM, RIM_WIDTH), obstacles: [CARD, leverFootprint(LEVER_AT), modeSwitchFootprint(MODE_SWITCH_AT)] },
};
