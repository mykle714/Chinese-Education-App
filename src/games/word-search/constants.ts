import { COLORS, type RampHue } from "../../theme/colors";
import type { CPCDSize } from "../../components/ForeignText";
import type { MarkType } from "../../types";
import type { Medal } from "./types";
// Word Search's own mix: 1 Unfamiliar + 5 Target + 2 Comfortable + 1 Mastered = 9.
// The board went 12 words → 9 on 2026-08-28 (and 9×6 → 7×6 with it), which put the
// mix back on the "HALF of Bubble Match's 2/10/6/2" shape it started from (1/5/3/1
// = 10); the one extra word came off Comfortable rather than Target, so the board
// still leans on the band the player is actively learning.
export const GAME_DISTRIBUTION: Record<string, number> = {
    Unfamiliar: 1,
    Target: 5,
    Comfortable: 2,
    Mastered: 1,
};

/** Total target words in a board (sum of the distribution) = 9. */
export const TOTAL_WORDS = Object.values(GAME_DISTRIBUTION).reduce((a, b) => a + b, 0);

/** This game's key in the shared `wins` table (see useGameWins / migration 78).
    Lifted out of WordSearchPage so the hub item reads the same bucket the page
    writes. Word Search logs every completion under level 1 regardless of mode —
    pinyin/no-pinyin deliberately share one bucket, so its hub count is already a
    whole-game total. */
export const GAME_KEY = "wordSearch";

/** The single `wins.level` bucket every Word Search completion is logged under
    (the table's level column is required, but this game has no levels). */
export const WIN_LEVEL = 1;

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
    /**
     * The mode's PRIMARY mastery track (docs/MASTERY_REWORK.md). Word Search is the
     * one game whose mark type varies BY MODE, which is why this lives per-config
     * instead of as a whole-game `MARK_TYPE` like the other three games have: with
     * the pinyin row shown the player is recalling the word from its meaning with a
     * phonetic crutch (PRODUCTION); without it they must read the bare characters
     * (READING).
     *
     * PRIMARY means three specific things, all of which stay single-valued even
     * though a find can now write more than one mark (see `extraMarkTypes`):
     *   1. the server pools and cooldown-gates the BOARD on this track alone
     *      (`getWordSearchGrid` maps `?mode=` to one `gameMarkType`) — a pool query
     *      can only bucket by one mark history;
     *   2. challenge eligibility reads this field only, so a secondary production
     *      track can never pull a reading board into the Study Challenge pool
     *      (src/games/__tests__/challengePool.test.ts);
     *   3. it leads the hub sub-tile's subtitle.
     *
     * Single source of truth for the /api/flashcards/mark call (WordSearchPage)
     * and the mode sub-tile's track label (WordSearchHubItem).
     */
    markType: MarkType;
    /**
     * ADDITIONAL tracks a find in this mode also marks, beyond `markType`.
     *
     * No-Pinyin earns BOTH: the prompt list is English glosses, so hunting the word
     * down is recall-from-meaning (PRODUCTION), and the grid carries no pinyin, so
     * confirming a run of cells is reading bare characters (READING). One action,
     * two genuinely different skills — the only surface in the app that clears both
     * at once. Pinyin mode does NOT get `reading` in return: its pinyin row is
     * exactly the crutch the reading track is defined by the absence of.
     *
     * ⚠️ A secondary mark is BEST-EFFORT. The board was pooled on `markType`, so a
     * card can be off cooldown for reading while still cooling for production; the
     * `/api/flashcards/mark` chokepoint then drops the production mark (logged
     * `[MarkSuppressed]`, docs/HYDRA_BUBBLES.md § 8). That is the correct outcome —
     * the cooldown rule is exactly what stops one board from inflating a track — but
     * it means "emits both" is a statement about the ATTEMPT, not a guarantee.
     */
    extraMarkTypes?: MarkType[];
}

export const MODE_CONFIGS: WordSearchModeConfig[] = [
    { mode: "pinyin", showPinyin: true, label: "Pinyin", markType: "production" },
    {
        mode: "no-pinyin",
        showPinyin: false,
        label: "No Pinyin",
        markType: "reading",
        extraMarkTypes: ["production"],
    },
];

/** Every track a find in this mode attempts to mark, primary first. The ONE list
 *  both the mark call and the hub label are built from, so they cannot disagree. */
export function modeMarkTypes(cfg: WordSearchModeConfig): MarkType[] {
    return [cfg.markType, ...(cfg.extraMarkTypes ?? [])];
}

/** Resolve a mode slug (from nav state) to its config, or null if missing/invalid
 *  — the page redirects to /games rather than defaulting, so a mode must be
 *  explicitly chosen from the hub. */
export function modeConfigFor(mode: unknown): WordSearchModeConfig | null {
    return MODE_CONFIGS.find((m) => m.mode === mode) ?? null;
}

/** `?Unfamiliar=2&Target=6&...` query built from the distribution. */
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
 * The hint accent — the ink every part of the hint mechanic is drawn in: the
 * lightbulb on the `.hintbar` button, the banked charge dots, and the revealed
 * mask text (`WordSearchHintRow`).
 *
 * It used to be a free-floating `#FB8C00` amber that also tinted the hinted word's
 * gloss in the word list, so the two would pair up. The word list no longer has a
 * hinted state (the reveal names the word outright — see docs/WORD_SEARCH_GAME.md
 * §3), and the redesign has a palette member for exactly this job, so the constant
 * is now an alias for `COLORS.warnInk` (--orgA) rather than its own hue.
 */
export const HINT_ACCENT_COLOR = COLORS.warnInk;

/**
 * Trailing mark on a **No Pinyin** (component) hint island that still has
 * something hidden — "there is more to this character, it just isn't shown
 * yet". It is exactly ONE character and deliberately a dash rather than
 * underscores: a component island has no letter-count to blank out, so a run
 * of underscores would imply a count that doesn't exist. A single em dash
 * carries no count at all. See §5a-ii.
 *
 * The Pinyin board does NOT use it: its first hint press buys the whole
 * skeleton (every island as `HINT_LETTER_BLANK` per hidden letter), so it has
 * no state in which an island's length is unknown. It briefly carried a
 * count-only rung drawn with this mark (2026-08-29, same day); see `buildMask`
 * for why that rung was dropped again.
 */
export const HINT_REMAINDER_MARK = "—";

/**
 * Blank stand-in for ONE still-hidden pinyin letter on the Pinyin board's hint
 * mask — classic hangman spacing, one underscore per omitted letter, so the
 * whole word's length is visible from the first press and each reveal visibly
 * consumes the blanks it fills. Deliberately leaks every syllable's letter
 * count, which is what that first press buys: knowing "this syllable is 4
 * letters" is a useful, honest scaffold rather than an answer, and it keeps the
 * mask width stable as units fill in. Tone diacritics ride on their letter (`ǎ`
 * is one blank, not two). See §5a.
 */
export const HINT_LETTER_BLANK = "_";

/**
 * cpcd size for each grid cell. `sm` (32px column). The board is 7 rows tall
 * (down from 9 on 2026-08-28), so the pinyin row no longer crowds the height on
 * a ~402px frame (see docs/WORD_SEARCH_GAME.md §3).
 */
export const CELL_SIZE: CPCDSize = "sm";

/**
 * Gap (px) between adjacent cells, on BOTH axes. Every cell is square
 * (`aspect-ratio: 1`), so one value spaces the board evenly without the row
 * pitch having to be measured and forced — which is what the old 16px value
 * needed, back when a cell's height was whatever its pinyin made it.
 *
 * 4px is the design's `.wsg` gap (docs/SHELF_REDESIGN.md, artboard 13). It is
 * deliberately tight: a selection is painted ON the cells now, so the gutter's
 * only job is to keep two adjacent tiles from fusing into one rectangle.
 * Tunable. See docs/WORD_SEARCH_GAME.md §3.
 */
export const CELL_GAP = 4;

/**
 * Breathing room (px) reserved on every side of the fitted grid inside its
 * container. Applied in `useFitScale` (not as a CSS margin) so the centered,
 * scaled grid never touches — or gets clipped at — the container edges. Tunable.
 * See docs/WORD_SEARCH_GAME.md §3.
 */
export const GRID_MARGIN = 12;

/**
 * How long a true miss's flash (red highlight + shake) stays visible before
 * auto-clearing. A bonus-word match is blue at every length — 2+ characters also
 * shake, a single character does not (see `WordSearchGrid.tsx`) — and has NO
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

// NOTE: `formatTimeMs` used to live here. It moved to src/utils/timeUtils.ts when
// Match Speed became a third caller — import it from there.

/** Human-readable subtitle for a mode slug (e.g. "Pinyin"), or the raw slug if
 *  unknown. Used by the resume card to name the saved board's mode. */
export function modeLabel(mode: WordSearchMode): string {
    return MODE_CONFIGS.find((m) => m.mode === mode)?.label ?? mode;
}

/**
 * THE GAME'S HUE — its hub row's colour AND the accent ground its own screen is
 * flooded with (docs/SHELF_REDESIGN.md § A6b).
 *
 * It lives here rather than as a literal in `GAME_REGISTRY` so the two cannot drift:
 * the registry reads this, and the page passes it to `gameSurfaceSx` /
 * `GameSurfaceProvider`. Tapping a pur row must open a pur screen.
 */
export const GAME_HUE: RampHue = "pur";
