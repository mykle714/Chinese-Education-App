/**
 * Writing Grid — client constants (docs/WRITING_PRACTICE_REWORK.md § 2).
 * Board size, level-per-position and medals are the shared contract
 * (server/contracts/writingGrid.ts); this file holds only what the page draws.
 */
import type { RampHue } from "../../theme/colors";
import { WRITING_FOCUS_SIZE } from "../../components/handwriting/levelBehavior";

/** `wins` table key (a win is logged per medalled board, like Speed Reading). */
export const GAME_KEY = "writingGrid";
/** Registry id (also the personal-best game id). */
export const GAME_ID = "writing-grid";
/** The writing skill's hue — the Writing Center's purple. */
export const GAME_HUE: RampHue = "pur";

/** 3·2·1·Go, as in Match Speed (src/games/match-speed/constants.ts → COUNTDOWN_STEPS). */
export const COUNTDOWN_STEPS = ["3", "2", "1", "Go!"];
export const COUNTDOWN_STEP_MS = 700;

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

export const MEDAL_LABEL = { gold: "🥇 Gold", silver: "🥈 Silver", bronze: "🥉 Bronze" } as const;

/** localStorage key for Writing Grid's own device-local preferences (useLocalGameSettings). */
export const SETTINGS_STORAGE_KEY = "writingGrid.settings";
/**
 * `showTimer` — whether the stopwatch's numerals are visible (the eye in `GameTimer`).
 * The clock keeps running either way, and the end popup always shows the final time.
 */
export const DEFAULT_SETTINGS = { showTimer: true };
