import type { MarkType } from "../../types";
import { COLORS, type RampHue } from "../../theme/colors";
import type { WordOutcome } from "./types";

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

/**
 * Silence, in ms, between the answer narration (the committed word, § 3.3b) and the next
 * prompt's autoplayed word (§ 3.1a), so the two are heard as separate words rather than
 * one phrase. Only applies when an answer narration was in flight; a skip or the first
 * prompt of a load speaks at once.
 */
export const PROMPT_AUDIO_GAP_MS = 500;

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

// ── The 8px grid (chrome only) ───────────────────────────────────────────────

/**
 * Memory Map's CHROME is drawn on an 8px grid: every padding, gap, inset and control
 * dimension in the prompt bar, the compass markers and the page furniture is a whole
 * multiple of 8, written as a plain pixel literal. There is deliberately no `grid(n)`
 * helper: 8 is also MUI's spacing unit, so `gap: 1` / `mb: 2` are already on the grid
 * and a second spelling of the same number would only invite the two to disagree.
 *
 * ── THE WORLD IS NOT ON IT ANY MORE ──────────────────────────────────────────
 * Word tiles used to snap every edge to the same 8px lattice (`WORLD_GRID`). That died
 * with the slot tree (2026-10-06): words now hang off their parents at arbitrary
 * bearings and are tilted −30°…+30° (normal around 0°), so no lattice can hold their edges. Positions are
 * continuous, derived by `layoutMap` (server/services/memoryMapLayout.ts).
 */

// ── Camera ───────────────────────────────────────────────────────────────────

/**
 * Screen pixels per world unit at zoom 1. One world unit is the height of an unscaled
 * line of text, so this is effectively the base font size of the map.
 *
 * Successively 34 → 36 → 40, each step also buying a little legibility at the same
 * zoom. (It used to be paired with the world grid's 0.2-unit step — 0.2 × 40 = 8px —
 * until the world grid was retired with the slot tree.)
 */
export const PIXELS_PER_WORLD_UNIT = 40;

/**
 * Zoom clamp. The minimum is the legibility floor — zoomed all the way out, the
 * smallest word must still be readable, because a map you cannot read is not a reading
 * game (§ 6). The maximum exists only to stop a pinch running away.
 */
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 3;

/**
 * How far the player may pan past the map, as a fraction of the GAME VIEWPORT (the
 * `.memory-map-world` water panel below the prompt, not the window). At the limit in any
 * direction the map's outermost edge sits on this line of that panel — 0.25 leaves the
 * coast a quarter of the way in, so at most 75% of the panel is open water.
 * Enforced by `clampCameraToMap` (cameraBounds.ts); 0.5 would pin the edge at centre,
 * 0 would let the map leave the screen entirely.
 */
export const PAN_EDGE_FRACTION = 0.25;

/** Padding, in world units, left around the map when fitting it to the screen. */
export const FIT_PADDING = 2;

/**
 * Multiplier on the fitted zoom of a fresh run, so the opening frame starts closer than
 * "the whole map exactly fits". The outer `FIT_PADDING` margin is spent first; past
 * that the outermost words sit off-screen, which a pan reveals and the island compass
 * (MemoryMapIslandCompass) points toward. Still clamped to MIN_ZOOM / MAX_ZOOM.
 *
 * Raised 1.15 → 1.4 (2026-10-06): the opening frame should read as legible words, not
 * as an overview of the whole archipelago.
 */
export const FIT_ZOOM_BOOST = 1.4;

/**
 * THE GAME'S HUE — its hub row's colour AND the accent ground its own screen is
 * flooded with (docs/SHELF_REDESIGN.md § A6b).
 *
 * It lives here rather than as a literal in `GAME_REGISTRY` so the two cannot drift:
 * the registry reads this, and the page passes it to `gameSurfaceSx` /
 * `GameSurfaceProvider`. Tapping a blue row must open a blue screen.
 *
 * Blue since 2026-10-06 (owner; orange before). It matches the map's own water
 * (`COLORS.blueAccent`, MemoryMapWorld.tsx), and it is shared with Match Speed's hub row.
 */
export const GAME_HUE: RampHue = "blu";

/**
 * Hue per outcome. Hue ALONE carries the result — no icons, no patterns (Q23).
 *
 * The MID tier, used as a FILL — today only by the end popup's tally swatches
 * (MemoryMapPage). On the map itself an outcome is carried by the glyph OUTLINE instead
 * (`OUTCOME_OUTLINE`, mark tier, below): the filled tiles this colour used to paint were
 * removed on 2026-10-06 when words became bare outlined characters.
 */
export const OUTCOME_FILL: Record<WordOutcome, string> = {
    green: COLORS.grnM,
    orange: COLORS.orgM,
    red: COLORS.redM,
};

// ── Glyph outlines (the map's words) ─────────────────────────────────────────

/**
 * Width of the coloured outline a SELECTED or MARKED word's characters wear, in
 * world-layer px (so it scales with the camera zoom, not with the word's own size).
 * Drawn OUTSIDE the glyph (`paint-order: stroke fill` with a stroke twice this wide).
 *
 * Counted in EVERY word's collision shape (glyphShapes.ts → `shapeFromMeasure`), outline
 * or not: the layout is independent of run state, so arming or marking a word never
 * nudges the map, and an outline that appears never crosses a neighbour's ink. The cost
 * is a 1px sliver of extra water between two unoutlined words.
 */
export const OUTLINE_PX = 1;

/**
 * Outline colour per state (docs/MEMORY_MAP_GAME.md § 2.3, § 3.3). Mark tier of the ramp —
 * the strong tier, because a 1px ring has to carry the state on its own now that there
 * is no filled tile behind the word.
 *
 * An UNANSWERED word has no outline at all (owner, 2026-10-06) — plain ink on the water.
 * The outline appears only once a word means something: blue while armed (outside the
 * outcome set, so it never looks graded), then its outcome colour once marked.
 */
export const OUTLINE_SELECTED = COLORS.bluMk;
export const OUTCOME_OUTLINE: Record<WordOutcome, string> = {
    green: COLORS.grnMk,
    orange: COLORS.orgMk,
    red: COLORS.redMk,
};
