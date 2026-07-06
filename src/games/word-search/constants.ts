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

/**
 * Word Search ships as two separate Games-hub entries (like Bubble Match's
 * difficulty levels), NOT one game with an in-game pinyin toggle: a "Pinyin"
 * board (colored pinyin always on) and a "No Pinyin" board. The chosen mode is
 * fixed for the whole run — passed via nav `state.mode` from the hub, with no
 * in-game switch — and each mode keeps its OWN saved board (see gameStateStorage
 * `mode` scoping). The old shared `useFlashcardLearnSettings` pinyin/colorless
 * toggles no longer drive this game. See docs/WORD_SEARCH_GAME.md §3.
 */
export type WordSearchMode = "pinyin" | "no-pinyin";

export interface WordSearchModeConfig {
    mode: WordSearchMode;
    /** Whether the grid renders the per-cell pinyin row (always colored when on;
     *  the colorless variant was removed). */
    showPinyin: boolean;
    /** Hub sub-card subtitle. */
    label: string;
}

export const MODE_CONFIGS: WordSearchModeConfig[] = [
    { mode: "pinyin", showPinyin: true, label: "Pinyin" },
    { mode: "no-pinyin", showPinyin: false, label: "No Pinyin" },
];

/** Resolve a mode slug (from nav state) to its config, or null if missing/invalid
 *  — the page redirects to /games rather than defaulting, so a mode must be
 *  explicitly chosen from the hub. */
export function modeConfigFor(mode: unknown): WordSearchModeConfig | null {
    return MODE_CONFIGS.find((m) => m.mode === mode) ?? null;
}

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
export const HINT_COST = 1;

/**
 * Shared amber "hint" accent color — the Bopomofo mask text (`WordSearchHintRow`)
 * and the matching gloss in the top word list (`WordSearchWordList`) both use
 * this so the two visually pair up as "this is the word that mask is for."
 * Matches the armed-state amber already used by the header hint button /
 * hint meter (`WordSearchHeader.tsx`, `WordSearchHintBar.tsx`).
 */
export const HINT_ACCENT_COLOR = "#FB8C00";

/**
 * Trailing underscore count in a per-character hint island for a syllable
 * whose Bopomofo reveal isn't yet complete — always `LETTER_HINT_BLANK_WIDTH`,
 * regardless of how many units have been revealed or the syllable's actual
 * unit count, so the island never leaks how many units remain. See §5a.
 */
export const LETTER_HINT_BLANK_WIDTH = 3;

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
 * Extra downward nudge for the selection/found stadium shape, as a fraction of
 * its own thickness (not px) — since that thickness is measured live and
 * varies with cell size/scale, a fraction keeps the nudge proportional across
 * screen sizes instead of over- or under-shooting on smaller/larger cells.
 * Applied on top of the glyph-centering offset computed in `WordSearchGrid`.
 * Tunable. Used when `showPinyin` is true; see
 * `SELECTION_EXTRA_OFFSET_Y_FRAC_NO_PINYIN` for the pinyin-less variant.
 */
export const SELECTION_EXTRA_OFFSET_Y_FRAC = 0.15;

/**
 * Same nudge as `SELECTION_EXTRA_OFFSET_Y_FRAC`, but for pinyin-less mode.
 * Without the pinyin row pulling the character upward within its cell, the
 * glyph sits lower and closer to true cell-center already, so the downward
 * nudge tuned for pinyin mode overshoots and reads as off-center. Tunable
 * independently of the pinyin-mode value.
 */
export const SELECTION_EXTRA_OFFSET_Y_FRAC_NO_PINYIN = 0.05;

/**
 * How long a true miss's flash (red highlight + shake) stays visible before
 * auto-clearing. A bonus-word match (blue for 2+ characters, or plain yellow
 * with no shake for a single character — see `WordSearchGrid.tsx`) has NO
 * auto-dismiss timer: its definition popup stays open until the player taps
 * elsewhere. Tunable.
 */
export const MISS_FLASH_MS = 320;

/**
 * Medal thresholds by total completion time, best-first. The last tier is the
 * floor (unbounded) — because play is untimed you always finish, just at the
 * lowest tier if slow. Tunable. See doc §5.
 */
export const MEDAL_THRESHOLDS: { medal: Medal; maxSeconds: number; emoji: string }[] = [
    { medal: "gold", maxSeconds: 60, emoji: "🥇" },
    { medal: "silver", maxSeconds: 120, emoji: "🥈" },
    { medal: "bronze", maxSeconds: Infinity, emoji: "🥉" },
];

/** Resolve a completion time (seconds) to its medal tier. */
export function medalForTime(seconds: number): { medal: Medal; emoji: string } {
    const tier = MEDAL_THRESHOLDS.find((t) => seconds <= t.maxSeconds) ?? MEDAL_THRESHOLDS[MEDAL_THRESHOLDS.length - 1];
    return { medal: tier.medal, emoji: tier.emoji };
}
