/**
 * Superposition — client constants (docs/SUPERPOSITION_GAME.md). The board's size in
 * characters and the word picking are the shared contract (server/contracts/superposition.ts);
 * this file holds what the page draws. GRID_UNIT_PX and TILE_UNITS are the two numbers to
 * tune: everything on the board derives from them.
 */
import type { RampHue } from "../../theme/colors";
import type { SpeedTierLadder } from "../shared/runTiers";

/** Registry id (also the personal-best game id and the mark's `surface`). */
export const GAME_ID = "superposition";

/**
 * Speed tiers by the time to build all SUPERPOSITION_CHAR_COUNT (4) characters, best-first
 * (src/games/shared/runTiers.ts: tier 1 is the best; past the last cutoff is tier 7).
 * Superposition keeps no accuracy tier.
 * ⚠️ PLACEHOLDERS: the game never had medals, so these are first guesses; tune from play data.
 */
export const SPEED_TIERS: SpeedTierLadder = {
    maxMs: [20_000, 30_000, 45_000, 60_000, 90_000, 120_000],
};
/** Game surface hue: teal, the one game hue no other game wears. */
export const GAME_HUE: RampHue = "tea";

/** The snapping grid's pitch (px). A tile's position is always a whole number of units. */
export const GRID_UNIT_PX = 16;
/** A stroke tile's side, in grid units. */
export const TILE_UNITS = 9;
/** A stroke tile's side (px). */
export const TILE_PX = TILE_UNITS * GRID_UNIT_PX;
/** Clear grid units kept between a freshly dealt tile and every edge of the board. Drags may still reach the edge. */
export const SPAWN_MARGIN_UNITS = 2;
/** How far a deal's tile positions spread on each axis of the bottom-centre bunch. */
export const SPAWN_SPREAD_UNITS = 6;
/** A tile's outline width (px). */
export const TILE_OUTLINE_PX = 2;
/** Pointer travel (px) before a press on the board becomes a drag rather than a tap. */
export const DRAG_SLOP_PX = 6;
/**
 * Where a dragged tile hangs from the finger, as a fraction of the tile's side: centred
 * horizontally, 1/5 of the way up from the bottom edge. A fixed grip (rather than wherever
 * the press landed) keeps most of the tile visible above the finger while it is moved.
 * Read by `SuperpositionBoard` → `handlePointerMove`.
 */
export const DRAG_GRIP_X_FRACTION = 0.5;
export const DRAG_GRIP_Y_FRACTION = 0.8;
/** Seconds between hints. */
export const HINT_COOLDOWN_SECONDS = 15;

/** The hanzi-writer glyph box's side, in glyph units. */
const GLYPH_UNITS = 1024;
/** The on-screen gap (px) below which two strokes read as the same stroke. */
const LOOKALIKE_TOLERANCE_PX = 2;
/**
 * Two strokes this close (glyph units) count as the same stroke: the worst pointwise gap
 * between their medians. It is derived from the tile so the tolerance stays a fixed on-screen
 * distance when the tile is resized. The tolerance exists because a swap the eye cannot see
 * must not leave a finished-looking stack un-green; docs/SUPERPOSITION_GAME.md § Lookalike
 * strokes has the measurements.
 */
export const LOOKALIKE_TOLERANCE_UNITS = (LOOKALIKE_TOLERANCE_PX * GLYPH_UNITS) / TILE_PX;
