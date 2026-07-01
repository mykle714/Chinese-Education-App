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
 * cpcd size for each grid cell. `sm` (32px column) for now; 16 rows with pinyin
 * may crowd the height on a ~393px frame — accepted for v1, revisit a compact
 * variant later (see docs/WORD_SEARCH_GAME.md §3).
 */
export const CELL_SIZE: CPCDSize = "sm";

/**
 * Selections shorter than this never trigger a dictionary lookup (a single
 * character is too noisy to pop an info card for). See doc §4.
 */
export const MIN_LOOKUP_LENGTH = 2;

/** How long the discovery info-card stays up before auto-dismissing (ms). */
export const INFO_CARD_DURATION_MS = 2600;

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
