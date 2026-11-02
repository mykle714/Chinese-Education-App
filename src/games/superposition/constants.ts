/**
 * Superposition — client constants (docs/SUPERPOSITION_GAME.md). The board's size in
 * characters and the word picking are the shared contract (server/contracts/superposition.ts);
 * this file holds what the page draws. GRID_UNIT_PX and TILE_UNITS are the two numbers to
 * tune: everything on the board derives from them.
 */
import type { RampHue } from "../../theme/colors";

/** Registry id (also the personal-best game id and the mark's `surface`). */
export const GAME_ID = "superposition";
/** Game surface hue: teal, the one game hue no other game wears. */
export const GAME_HUE: RampHue = "tea";

/** The snapping grid's pitch (px). A tile's position is always a whole number of units. */
export const GRID_UNIT_PX = 8;
/** A stroke tile's side, in grid units. */
export const TILE_UNITS = 12;
/** A stroke tile's side (px). */
export const TILE_PX = TILE_UNITS * GRID_UNIT_PX;
/** Clear grid units kept between a freshly dealt tile and every edge of the board. Drags may still reach the edge. */
export const SPAWN_MARGIN_UNITS = 3;
/** How far a deal's tile positions spread on each axis of the bottom-centre bunch. */
export const SPAWN_SPREAD_UNITS = 12;
/** A tile's outline width (px). */
export const TILE_OUTLINE_PX = 2;
/** Pointer travel (px) before a press on the board becomes a drag rather than a tap. */
export const DRAG_SLOP_PX = 6;

/**
 * The ink (outline area, square glyph units) at which a tile's merged strokes stop taking
 * more. 30,000 is set so 灬's four dots form one group: three dots peak near 29,300 and all
 * four start near 32,600 across the 14 characters measured. It does not depend on tile size.
 */
export const INK_MERGE_THRESHOLD = 30000;

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
