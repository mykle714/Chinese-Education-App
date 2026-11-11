import type { MarkType } from "../../types";
import { COLORS, type RampHue } from "../../theme/colors";
import type { RunTally, WordOutcome } from "./types";
import { gradeAccuracy, gradeSpeed, type AccuracyTierLadder, type RunTiers, type SpeedTierLadder } from "../shared/runTiers";

/**
 * Memory Map constants (docs/MEMORY_MAP_GAME.md).
 *
 * Single source of truth for the game's mark type — used by the /api/flashcards/mark
 * call in useMemoryMapRun AND re-exported through the Games hub registry as the card's
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

/** Registry id and localStorage key prefix. */
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

/**
 * How many words an flp game break asks the learner to find before it closes (owner,
 * 2026-11-04; docs/MEMORY_MAP_GAME.md § 4a). Fewer when fewer are left uncoloured: the
 * break finishes the map and the next break starts it again.
 */
export const BREAK_PROMPTS = 5;

/**
 * Speed tiers by the time to find a full quota of BREAK_PROMPTS words, best-first
 * (src/games/shared/runTiers.ts: tier 1 is the best; past the last cutoff is tier 7).
 * A break that finishes the map on fewer words is scaled up to the quota's length, so a
 * tier asks for the same pace per word. The clock is hidden (`useActiveRunClock`).
 * ⚠️ PLACEHOLDERS: the game never had a clock, so these are first guesses.
 */
export const SPEED_TIERS: SpeedTierLadder = {
    maxMs: [15_000, 25_000, 35_000, 50_000, 70_000, 100_000],
};

/**
 * Accuracy tiers by "knew it" (green) words / words found, best-first: a recovered (orange)
 * or missed (red) word counts against it. ⚠️ PLACEHOLDERS: tune from play data.
 */
export const ACCURACY_TIERS: AccuracyTierLadder = {
    minRatio: [1, 0.95, 0.9, 0.8, 0.7, 0.6],
};

/** A finished break's tiers (never a left one, which the Stage reports untiered). */
export function runResultTiers(elapsedMs: number, tally: RunTally): RunTiers {
    const found = tally.green + tally.orange + tally.red;
    return {
        speed: gradeSpeed(elapsedMs, SPEED_TIERS, found > 0 ? elapsedMs * (BREAK_PROMPTS / found) : elapsedMs),
        accuracy: gradeAccuracy(tally.green, found, ACCURACY_TIERS),
    };
}

/**
 * Milliseconds a break holds on the map after its last answer before closing, so the
 * word's colour lands and its narration starts before the shrink (FLP_GAME_BREAKS.md § 2).
 */
export const BREAK_END_HOLD_MS = 700;

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
 * World-layer pixels per world unit. One world unit is the height of an unscaled line of
 * text. Since the camera became fixed (below) this no longer sets the on-screen size —
 * the fit zoom does — but it is still the unit every world-layer px constant
 * (`OUTLINE_PX`, `HIGHLIGHT_PX`) and the glyph measurement are expressed against.
 *
 * Successively 34 → 36 → 40, each step also buying a little legibility at the same
 * zoom. (It used to be paired with the world grid's 0.2-unit step — 0.2 × 40 = 8px —
 * until the world grid was retired with the slot tree.)
 */
export const PIXELS_PER_WORLD_UNIT = 40;

/**
 * The camera is FIXED (owner, 2026-11-04; docs/MEMORY_MAP_GAME.md § 6): no pan, no
 * pinch, no wheel. The whole map is always fitted to the game viewport by its limiting
 * dimension (`MemoryMapWorld` → `fitCamera`), and the server packs the map toward the
 * shape of that viewport (the frame, § 2.4b), so fitting it costs as little size as
 * possible. There is consequently no minimum zoom — a map that only fits small is
 * drawn small — and the pan limit, the opening zoom boost and the off-screen island
 * compass that existed to navigate a larger-than-screen map are gone.
 *
 * The one clamp left is a CEILING: a map of a handful of words would otherwise be
 * blown up to fill the screen with three giant characters. 3 is also the highlight
 * mask's canvas resolution (highlightMask.ts → `RESOLUTION`), so a ring is never drawn
 * coarser than a screen pixel.
 */
export const MAX_ZOOM = 3;

/** Padding, in world units, left around the map when fitting it to the screen. */
export const FIT_PADDING = 2;

/**
 * Opacity of a word the word finder did NOT match (§ 3.7) — the finder dims everything
 * else rather than painting the matches, so it never collides with the armed / outcome
 * rings. Low enough that the matches pop, high enough that the map's shape still reads.
 */
export const FINDER_DIMMED_OPACITY = 0.3;

/**
 * THE GAME'S HUE (docs/SHELF_REDESIGN.md § A6b).
 *
 * It lives here rather than as a literal in `GAME_REGISTRY` so the two cannot drift:
 * the registry reads this, and the flp break frame (`gameBreakFrameFor`,
 * GameBreakFrame.tsx) hands it to the game's parts through `GameSurfaceContext`.
 *
 * Blue since 2026-10-06 (owner; orange before). It matches the map's own water
 * (`COLORS.blueAccent`, MemoryMapWorld.tsx), and it is shared with Match Speed.
 */
export const GAME_HUE: RampHue = "blu";

// ── Glyph outlines (the map's words) ─────────────────────────────────────────

/**
 * The COLLISION margin around every word's characters, in world-layer px (so it scales
 * with the camera zoom, not with the word's own size). Until 2026-11-04 this was also the
 * drawn outline's width; the drawn ring is now the much wider `HIGHLIGHT_PX` below.
 *
 * Counted in EVERY word's collision shape (glyphShapes.ts → `shapeFromMeasure`), outline
 * or not: the layout is independent of run state, so arming or marking a word never
 * nudges the map, and an outline that appears never crosses a neighbour's ink. The cost
 * is a 1px sliver of extra water between two unoutlined words.
 */
export const OUTLINE_PX = 1;

/**
 * Width of the coloured highlight ring an armed or marked word's characters wear, in
 * world-layer px, measured outside the glyph (owner, 2026-11-04: "drastically" bigger,
 * 1px → 8px).
 *
 * Deliberately NOT `OUTLINE_PX`: the layout still packs words at the 1px collision margin,
 * so this ring OVERLAPS the water and the edges of neighbouring words (owner's choice over
 * spacing the whole map out). It never hides anyone's characters, because the world draws
 * every ring in a layer UNDER every word's ink (MemoryMapWorld.tsx → `WORD_LAYERS`,
 * MemoryMapWord.tsx → THE TWO LAYERS).
 */
export const HIGHLIGHT_PX = 8;

/**
 * Outline colour per state (docs/MEMORY_MAP_GAME.md § 2.3, § 3.3). Mark tier of the ramp —
 * the strong tier, because the ring has to carry the state on its own now that there
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
