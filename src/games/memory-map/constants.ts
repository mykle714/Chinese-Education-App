import type { MarkType } from "../../types";

/**
 * Memory Map constants (docs/MEMORY_MAP_GAME.md).
 *
 * Single source of truth for the game's mark type — used by the /api/flashcards/mark
 * call in MemoryMapPage AND re-exported through the Games hub registry as the card's
 * mark-type chip, so the label on the hub cannot disagree with what the game writes.
 */

/**
 * The one mastery track this game feeds.
 *
 * READING, and the choice defines the game: the prompt is English and the map is
 * foreign script, so finding the answer requires reading. It is also what makes the
 * map's membership rule the reading track rather than core mastery (§ 2.1) — a word
 * leaves the map when the learner can READ it, whatever their recognition track says.
 */
export const MARK_TYPE: MarkType = "reading";

/** Registry id, route slug, and localStorage key prefix. */
export const GAME_KEY = "memory-map";

/** How many wrong taps a prompt survives before it locks in red (§ 3.3). */
export const MAX_TRIES = 3;

/** Milliseconds a wrong tap's red flash stays on the word it hit. */
export const WRONG_FLASH_MS = 450;

/**
 * Milliseconds a graduating word holds its colour before dissolving off the map.
 *
 * Long enough to read as "that one is finished" rather than as a rendering glitch. The
 * word is already answered, so this delay costs the player nothing.
 */
export const FADE_OUT_MS = 900;

/** How long the "N new words joined your map" toast stays up (§ 2.5). */
export const GROWTH_TOAST_MS = 4000;

// ── The 4px grid ─────────────────────────────────────────────────────────────

/**
 * The game's spacing quantum. EVERY padding, gap, inset and control dimension in
 * Memory Map's chrome is a whole multiple of this, expressed through `grid()` rather
 * than as a bare pixel literal, so that the values cannot drift apart one hand-tuned
 * pixel at a time (which is exactly how this file arrived at `7px 14px`, `3px`, `2px
 * 6px 2px 4px` and a 19px icon).
 *
 * MUI's `sx` shorthands (`gap: 1`, `mb: 2`) are already on this grid — the theme's
 * spacing unit is 8px — so they are left as they are. Only quarter and three-quarter
 * steps (`0.25` → 2px, `0.75` → 6px) would fall off it, and none are used.
 *
 * ── WHAT THE GRID DOES NOT GOVERN ────────────────────────────────────────────
 * Two things are deliberately exempt, and neither is an oversight:
 *
 *  1. **Hairlines** (`BORDER_PX`). A 4px fence between two words would be a wall. Border
 *     widths are strokes, not spacing, and `box-sizing: border-box` keeps them from
 *     moving anything else off the grid.
 *
 *  2. **The world layer.** Word boxes are sized by `wordBoxSize` at continuous scales
 *     (0.95–1.8) and then drawn through a continuous camera zoom, so their pixel
 *     dimensions are fractional by construction. Snapping them would open gaps along
 *     the shared edges that make an island read as one landmass — the grid is not worth
 *     breaking the game's central piece of geometry for. `PIXELS_PER_WORLD_UNIT` is on
 *     the grid anyway, so an unscaled box at zoom 1 does land on it.
 */
export const GRID = 4;

/** `grid(3)` → `"12px"`. The only way spacing should be written in this game. */
export const grid = (steps: number): string => `${steps * GRID}px`;

// ── Camera ───────────────────────────────────────────────────────────────────

/**
 * Screen pixels per world unit at zoom 1. One world unit is an unscaled word box's
 * height, so this is effectively the base font size of the map.
 *
 * On the 4px grid (36 = 9 × GRID), nudged up from 34 when the grid went in — which
 * also bought the map a little legibility at the same zoom.
 */
export const PIXELS_PER_WORLD_UNIT = 36;

/**
 * Zoom clamp. The minimum is the legibility floor — zoomed all the way out, the
 * smallest word must still be readable, because a map you cannot read is not a reading
 * game (§ 6). The maximum exists only to stop a pinch running away.
 */
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 3;

/** Padding, in world units, left around the map when fitting it to the screen. */
export const FIT_PADDING = 2;
