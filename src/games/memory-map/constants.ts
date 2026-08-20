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

// ── The 8px grid ─────────────────────────────────────────────────────────────

/**
 * Memory Map is drawn on an 8px grid, and unlike every other surface in the app that
 * grid governs BOTH halves of the game:
 *
 *  * **The chrome** — every padding, gap, inset and control dimension in the prompt
 *    bar, the compass markers and the page furniture is a whole multiple of 8, written
 *    as a plain pixel literal. There is deliberately no `grid(n)` helper: 8 is also
 *    MUI's spacing unit, so `gap: 1` / `mb: 2` are already on the grid and a second
 *    spelling of the same number would only invite the two to disagree.
 *
 *  * **The world** — word boxes are sized and placed so that every box EDGE falls on
 *    the same 8px lattice. That is enforced in `server/services/memoryMapSpawn.ts` by
 *    `WORLD_GRID` (0.2 world units), which is 8px precisely because
 *    `PIXELS_PER_WORLD_UNIT` below is 40. The two constants are a pair — see the
 *    `WORLD_GRID` docblock, which carries the reasoning.
 *
 * ── THE ONE EXEMPTION ────────────────────────────────────────────────────────
 * **Hairlines.** `BORDER_PX` in MemoryMapWord (1.5) and stroke widths generally. A
 * stroke is not spacing, and an 8px fence between two words would be a wall.
 * `box-sizing: border-box` keeps them from pushing anything else off the grid.
 *
 * The world layer used to be exempt too, on the grounds that snapping would open gaps
 * along the shared edges that fuse an island into one landmass. That turned out to be
 * true only of snapping sizes OR positions; snapping both makes tangency exact. The
 * history is in `WORLD_GRID`.
 */

// ── Camera ───────────────────────────────────────────────────────────────────

/**
 * Screen pixels per world unit at zoom 1. One world unit is an unscaled word box's
 * height, so this is effectively the base font size of the map.
 *
 * **40 = 5 × 8, and it is one half of a pair.** `WORLD_GRID` in
 * `server/services/memoryMapSpawn.ts` is 0.2 world units *because* 0.2 × 40 = 8px;
 * change this number alone and the map's geometry quietly stops being on an 8px grid
 * without anything failing. Change them together or not at all.
 *
 * Successively 34 → 36 → 40, each step also buying a little legibility at the same
 * zoom.
 */
export const PIXELS_PER_WORLD_UNIT = 40;

/**
 * Zoom clamp. The minimum is the legibility floor — zoomed all the way out, the
 * smallest word must still be readable, because a map you cannot read is not a reading
 * game (§ 6). The maximum exists only to stop a pinch running away.
 */
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 3;

/** Padding, in world units, left around the map when fitting it to the screen. */
export const FIT_PADDING = 2;
