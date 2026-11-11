/**
 * Writing Grid — client constants (docs/WRITING_PRACTICE_REWORK.md § 2).
 * Board size and level-per-position are the shared contract
 * (server/contracts/writingGrid.ts); this file holds what the page draws and the run's
 * speed tiers.
 */
import type { RampHue } from "../../theme/colors";
import { WRITING_FOCUS_SIZE } from "../../components/handwriting/levelBehavior";
import type { SpeedTierLadder } from "../shared/runTiers";

/** `wins` table key (a win is logged per finished board, like Speed Reading). */
export const GAME_KEY = "writingGrid";
/** Registry id (also the personal-best game id). */
export const GAME_ID = "writing-grid";
/** Game surface hue — orange (Memory Map's hue until it moved to blue, 2026-10-06).
 *  Deliberately NOT the writing skill's purple (`pur`), the same way Speed
 *  Reading wears its own `yel` rather than reading's green. */
export const GAME_HUE: RampHue = "org";

// The pre-run countdown is shared: src/games/shared/GameCountdown.tsx.

/** Pointer travel (px) before a press on a Phase 1 cell becomes a drag. */
export const DRAG_SLOP_PX = 6;
/**
 * Gap between grid cells (px) — the MINIMUM, reserved in the cell-size fit. When the
 * frame has room left over after the cells are sized (WritingGridBoard), each axis's
 * gap grows into that slack, up to CELL_GAP_MAX.
 */
export const CELL_GAP = 10;
/** Ceiling (px) for a slack-widened gap, so a tall or wide frame never scatters the grid. */
export const CELL_GAP_MAX = 28;
/**
 * Phase 2: slots at this level or below (Snap, Trace, Step Through — the most-help end)
 * show the level's shadow preview (`levelPreview`) instead of a pinyin + dd prompt.
 */
export const SHADOW_PREVIEW_MAX_LEVEL = 3;
/** The writing canvas's coordinate space — shared with the editor so recognition matches. */
export const CANVAS_SIZE = WRITING_FOCUS_SIZE;

/**
 * Speed tiers by a finished board's total active time, best-first
 * (src/games/shared/runTiers.ts: tier 1 is the best; past the last cutoff is tier 7).
 * Writing Grid keeps no accuracy tier. ~15s to arrange + 8 characters at ~6–10 strokes:
 * levels 1–4 ~8s each, 5–8 ~12s each, plus a retry or two.
 * ⚠️ PLACEHOLDERS: the old medal lines (gold 120s, silver 210s, bronze 360s) spread over
 * seven tiers, to be tuned from play data.
 */
export const SPEED_TIERS: SpeedTierLadder = {
    maxMs: [90_000, 120_000, 165_000, 210_000, 285_000, 360_000],
};
