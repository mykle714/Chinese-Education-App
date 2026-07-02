import type { CPCDSize } from "../../components/ForeignText";
import type { Medal } from "./types";
// Word Search uses HALF of Bubble Match's mix, keeping the same category
// proportions: 1 Unfamiliar + 5 Target + 3 Comfortable + 1 Mastered = 10.
// Derived from the bubble-match distribution so the two stay in step if it moves.
import { GAME_DISTRIBUTION as BUBBLE_DISTRIBUTION } from "../bubble-match/constants";

export const GAME_DISTRIBUTION: Record<string, number> = Object.fromEntries(
    Object.entries(BUBBLE_DISTRIBUTION).map(([cat, n]) => [cat, Math.max(1, Math.round(n / 2))])
);

/** Total target words in a board (sum of the distribution) = 10. */
export const TOTAL_WORDS = Object.values(GAME_DISTRIBUTION).reduce((a, b) => a + b, 0);

/** `?Unfamiliar=2&Target=10&...` query built from the distribution. */
export const GRID_QUERY = Object.entries(GAME_DISTRIBUTION)
    .map(([cat, n]) => `${encodeURIComponent(cat)}=${n}`)
    .join("&");

/**
 * Hint meter (see docs/WORD_SEARCH_GAME.md §5a). The bar holds `HINT_BAR_UNITS`
 * hollow segments; each successful find fills one. A hint becomes usable once at
 * least `HINT_COST` segments are filled, and spending a hint drains that many.
 * The threshold line in the bar is drawn after `HINT_COST` segments. Tunable.
 */
export const HINT_BAR_UNITS = 8;
export const HINT_COST = 4;

/**
 * cpcd size for each grid cell. `sm` (32px column) for now; 10 rows with pinyin
 * may crowd the height on a ~393px frame — accepted for v1, revisit a compact
 * variant later (see docs/WORD_SEARCH_GAME.md §3).
 */
export const CELL_SIZE: CPCDSize = "sm";

/**
 * Gap (px) between adjacent cpcd cells. Applied directly as the CSS grid
 * column gap; `WordSearchGrid` derives the row gap from this same value (a
 * fixed row track of `columnWidth + CELL_GAP`) so row and column spacing —
 * measured character-center to character-center — stay equal on both axes.
 * Tunable. See docs/WORD_SEARCH_GAME.md §3.
 */
export const CELL_GAP = 16;

/**
 * Breathing room (px) reserved on every side of the fitted grid inside its
 * container. Applied in `useFitScale` (not as a CSS margin) so the centered,
 * scaled grid never touches — or gets clipped at — the container edges. Tunable.
 * See docs/WORD_SEARCH_GAME.md §3.
 */
export const GRID_MARGIN = 12;

/**
 * Extra downward nudge for the selection/found circle, as a fraction of the
 * circle's own diameter (not px) — since `cellDiameter` is measured live and
 * varies with cell size/scale, a fraction keeps the nudge proportional across
 * screen sizes instead of over- or under-shooting on smaller/larger cells.
 * Applied on top of the glyph-centering `discOffsetY` in `WordSearchGrid`.
 * Tunable.
 */
export const DISC_EXTRA_OFFSET_Y_FRAC = 0.15;

/**
 * Medal thresholds by total completion time, best-first. The last tier is the
 * floor (unbounded) — because play is untimed you always finish, just at the
 * lowest tier if slow. Tunable. See doc §5.
 */
export const MEDAL_THRESHOLDS: { medal: Medal; maxSeconds: number; emoji: string }[] = [
    { medal: "gold", maxSeconds: 90, emoji: "🥇" },
    { medal: "silver", maxSeconds: 180, emoji: "🥈" },
    { medal: "bronze", maxSeconds: Infinity, emoji: "🥉" },
];

/** Resolve a completion time (seconds) to its medal tier. */
export function medalForTime(seconds: number): { medal: Medal; emoji: string } {
    const tier = MEDAL_THRESHOLDS.find((t) => seconds <= t.maxSeconds) ?? MEDAL_THRESHOLDS[MEDAL_THRESHOLDS.length - 1];
    return { medal: tier.medal, emoji: tier.emoji };
}
