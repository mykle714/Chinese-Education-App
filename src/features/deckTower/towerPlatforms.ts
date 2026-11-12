import { RIM_WIDTH, SORT_BIN_ASPECT, SORT_BIN_PLATFORM, insetRect, leverFootprint, type PawnRoam, type WorldRect } from "./iso";
import { FLP_CARD_ASPECT, FLP_CARD_CORNER_RATIO } from "../flashcards/constants";

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

/**
 * The card footprint — portrait, long side along world y. Centred on the platform.
 * Its proportions are the flp card's (`FLP_CARD_ASPECT`, the card FlashCardSection draws):
 * the study camera lands the tower's top card exactly on the flp card laid over it
 * (docs/DECK_TOWER.md § "Studying the tower"), so the two must be one shape — corners
 * included (`FLP_CARD_CORNER_RATIO`, 0.45 at this width). Deepened from 6.6 (2026-10-24)
 * to match.
 */
export const CARD_W = 4.8;
export const CARD_D = (CARD_W * FLP_CARD_ASPECT.height) / FLP_CARD_ASPECT.width;
const CARD: WorldRect = {
    x: PLATFORM.x + (PLATFORM.w - CARD_W) / 2,
    y: PLATFORM.y + (PLATFORM.d - CARD_D) / 2,
    w: CARD_W,
    d: CARD_D,
    r: CARD_W * FLP_CARD_CORNER_RATIO,
};

/**
 * The deck's name plate, printed on the floor in front of the tower (the strip between
 * the stack's front-left face and the platform edge), as wide as the card. It names the
 * deck while a tall tower's top card is scrolled off screen, and it is the deck switch:
 * tapping it swaps the world's tower to its other deck (towerDecks.ts).
 * It is part of the floor — a floor decal, not an obstacle — so pawns walk over it,
 * stepping up onto the slightly raised push button (DeckTowerPlatform → `pawnSteps`).
 */
const LABEL_PLATE: WorldRect = { x: CARD.x, y: CARD.y + CARD_D + 0.5, w: CARD_W, d: 1.1, r: 0.25 };

/**
 * The focus lever's hatch centre (IsoLever, docs/FOCUS_MODE.md § 5): the LEFT corner of the
 * floor on screen (low x, high y — the platform's back-right corner mirrored across the
 * screen), beside the near end of the floor plate. Far enough off the tower's front-left
 * corner (~1.5 units diagonally) that the pawn — 1.2 units wide with its clearance — can
 * still walk round the tower past it.
 */
const LEVER_AT = { x: 1.2, y: 9.85 };

/**
 * Where the pawn starts, front-right of the tower. From there it wanders (`roam`). x sits
 * ~1.2 units off the tower's right face (CARD x + w = 7.9) — nudged in from 9.55
 * (2026-10-25); the walkable minimum is PAWN_FOOT_RADIUS + OBSTACLE_CLEARANCE off it.
 */
const PAWN_AT = { x: 9.1, y: 7.5 };

/**
 * The Writing Notebook's paper stack (IsoPaperStack, docs/DECK_TOWER.md § "The notebook
 * stack") — writing world only: the RIGHT corner of the floor on screen (high x, low y),
 * the focus lever's corner mirrored. A portrait sheet (US-letter-ish, 1.2 × 1.55). Its
 * left edge stands 1.45 units off the tower's right face (CARD x + w = 7.9), so the pawn
 * (1.2 wide with its clearance) can still walk between them round to the tower's back.
 */
const NOTEBOOK: WorldRect = { x: 9.35, y: 0.6, w: 1.2, d: 1.55, r: 0.1 };

/**
 * The mini sort platform's footprint (IsoSortPlatform, docs/DECK_TOWER.md § "The sort
 * platform") — main world only: the same right corner the notebook takes on the writing
 * world. An exact miniature of acp's Comfortable bin: acp's platform proportions (`SORT_BIN_ASPECT`,
 * 6.4 × 8) and corner radius, scaled to this width (0.2 of acp's; sortPlatformMetrics.ts →
 * `sortMiniScale`).
 *
 * Its right edge is pinned so the SHADOW stays off the floor's edge (owner's call
 * 2026-11-11): at its 0.24 thickness (`sortMiniThickness`) the shadow reaches ~0.39 past its
 * right (+x) edge (light.ts → the contact slide plus `shadowSpread`), so the right edge sits
 * at 10.43 and the shadow ends ~10.82, just inside the rim (PLATFORM.w − RIM_WIDTH = 10.84).
 * Its left edge (9.15) stands 1.25 off the tower's right face (CARD x + w = 7.9), just over
 * the 1.2 the pawn needs to walk between them (2 × PAWN_FOOT_RADIUS + 2 ×
 * OBSTACLE_CLEARANCE). The back edge sits 0.45 in from the floor's back side (0.29 inside the
 * rim; shadows never fall that way).
 */
const SORT_BIN_RIGHT = 10.43;
const SORT_BIN_W = 1.28;
const SORT_BIN: WorldRect = {
    x: SORT_BIN_RIGHT - SORT_BIN_W,
    y: 0.45,
    w: SORT_BIN_W,
    d: SORT_BIN_W * SORT_BIN_ASPECT,
    r: SORT_BIN_PLATFORM.r * (SORT_BIN_W / SORT_BIN_PLATFORM.w),
};

/**
 * Where a corner fixture's soft-introduction floor print stands (IsoFloorPrint,
 * docs/DECK_TOWER.md § "Corner fixture labels"). The print is turned to read along world −y
 * (`run="-y"`, up-right on screen) and set flush to its end (`anchor="end"`), so its lines
 * run toward the fixture from the floor in front of it (+y — "under" it on screen, the way
 * the deck plate sits in front of the tower) and stop `FIXTURE_LABEL_GAP` off its front-left face, row 2's arrow nearest it (part of
 * the line on the sort print; hung past it — IsoFloorPrint `tail` — on the notebook's). Across the run (world x) the two-line block
 * is centred on the fixture, but never so far right that its second line crosses the rim:
 * `FIXTURE_LABEL_MAX_X` caps the block's +x edge.
 *
 * The line count, size and pitch are restated here (`FIXTURE_LABEL_LINES`,
 * `FIXTURE_PRINT_FONT_SIZE`, `FIXTURE_PRINT_LINE_HEIGHT`) rather than read off
 * DeckTowerPlatform's `FIXTURE_PRINT`, because DeckTowerPlatform imports this file — keep
 * the two in step when a print's copy or size changes.
 */
const FIXTURE_LABEL_GAP = 0.28;
/** DeckTowerPlatform `FIXTURE_PRINT.fontSize` (both prints). */
const FIXTURE_PRINT_FONT_SIZE = 0.7;
/** IsoFloorPrint's default `lineHeight`: a line's pitch as a multiple of its font size. */
const FIXTURE_PRINT_LINE_HEIGHT = 1.25;
/** "ADD MORE / CARDS →" and "WRITING / NOTEBOOK" + hung "→" (FIXTURE_PRINT.sortBin / .notebook). */
const FIXTURE_LABEL_LINES = 2;
/** The block's breadth across its run (world x): one glyph height plus a pitch per extra line (2 lines at 0.7 → 1.575). */
const FIXTURE_LABEL_BREADTH =
    FIXTURE_PRINT_FONT_SIZE + (FIXTURE_LABEL_LINES - 1) * FIXTURE_PRINT_FONT_SIZE * FIXTURE_PRINT_LINE_HEIGHT;
/** The print's right limit: the rim's inner edge, less a hair so no glyph touches it. */
const FIXTURE_LABEL_MAX_X = PLATFORM.x + PLATFORM.w - RIM_WIDTH - 0.15;
/** The print's `at`: its end (along −y) a gap off the fixture's +y face, centred on its x within the rim. */
function labelUnder(fixture: WorldRect): { x: number; y: number } {
    return {
        x: Math.min(fixture.x + fixture.w / 2, FIXTURE_LABEL_MAX_X - FIXTURE_LABEL_BREADTH / 2),
        y: fixture.y + fixture.d + FIXTURE_LABEL_GAP,
    };
}

/** `roam` with one corner fixture appended as obstacle 2 (DeckTowerPlatform's layer slots follow this index). */
function roamWithCornerFixture(fixture: WorldRect): PawnRoam {
    return { area: insetRect(PLATFORM, RIM_WIDTH), obstacles: [CARD, leverFootprint(LEVER_AT), fixture] };
}

export interface TowerPlatformLayout {
    platform: WorldRect;
    /** The tower's footprint. */
    card: WorldRect;
    labelPlate: WorldRect;
    /** The plate's tap target: the plate grown on every side (the print is only ~18 px deep on a phone). */
    labelPlateHit: WorldRect;
    /** The focus lever's hatch centre. Its hatch is an obstacle in `roam`. */
    leverAt: { x: number; y: number };
    pawnAt: { x: number; y: number };
    /** The notebook paper stack's footprint (writing world only). */
    notebook: WorldRect;
    /** Where the notebook's si floor print ends (IsoFloorPrint `anchor="end"`), in front of the stack. */
    notebookLabelAt: { x: number; y: number };
    /**
     * Where the pawn may wander: the floor inside the platform's rim, around the tower.
     * The plate is NOT an obstacle — the pawn steps up onto it (IsoPawn `steps`). Obstacles are listed in
     * BACK-TO-FRONT draw order (the pawn reports its slot among them, `depthRankAmong`).
     */
    roam: PawnRoam;
    /**
     * `roam` on a platform that also stands the notebook stack: the same area, with the
     * stack appended as obstacle 2 — DeckTowerPlatform's layer slots follow this index.
     */
    notebookRoam: PawnRoam;
    /** The mini sort platform's footprint (main world only). */
    sortBin: WorldRect;
    /** Where the sort platform's si floor print ends (IsoFloorPrint `anchor="end"`), in front of the slab. */
    sortBinLabelAt: { x: number; y: number };
    /** `roam` on a platform that stands the sort platform: obstacle 2, like `notebookRoam`. */
    sortBinRoam: PawnRoam;
}

export const TOWER_LAYOUT: TowerPlatformLayout = {
    platform: PLATFORM,
    card: CARD,
    labelPlate: LABEL_PLATE,
    labelPlateHit: insetRect(LABEL_PLATE, -0.5),
    leverAt: LEVER_AT,
    pawnAt: PAWN_AT,
    // Back to front: the tower, then the lever's hatch (wholly in front of the tower's
    // front-left face), so it draws after the stack.
    roam: { area: insetRect(PLATFORM, RIM_WIDTH), obstacles: [CARD, leverFootprint(LEVER_AT)] },
    notebook: NOTEBOOK,
    notebookLabelAt: labelUnder(NOTEBOOK),
    notebookRoam: roamWithCornerFixture(NOTEBOOK),
    sortBin: SORT_BIN,
    sortBinLabelAt: labelUnder(SORT_BIN),
    sortBinRoam: roamWithCornerFixture(SORT_BIN),
};
