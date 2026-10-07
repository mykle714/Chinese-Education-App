import { RAMP, type RampHue } from "../../../theme/colors";

/**
 * strokeAid — the Writing Notebook's per-cell (per character position) stroke-order help
 * (docs/WRITING_NOTEBOOK.md § "Page anatomy" → Stroke aid). Pure, no React, so the
 * component files that use it (ShadowCell, NotebookWordBar, WritingNotebookPage) stay
 * fast-refresh clean.
 */

/** The stroke-order help on a shadow, in tap-cycle order (see {@link nextStrokeAid}). */
export type StrokeAid = "off" | "numbers" | "colored";
const STROKE_AID_CYCLE: readonly StrokeAid[] = ["off", "numbers", "colored"];

/** The state one tap moves to: off → numbers → colored → off. */
export function nextStrokeAid(aid: StrokeAid): StrokeAid {
    return STROKE_AID_CYCLE[(STROKE_AID_CYCLE.indexOf(aid) + 1) % STROKE_AID_CYCLE.length];
}

/**
 * The six chromatic ramp hues that carry a Mark tier, in CONTRASTING order so neighbouring
 * strokes stand apart. The Mark tier is the ramp's fluorescent fill (80–83% L) —
 * saturated enough to read on the white cell, where the Mid tier (~91% L, tried
 * 2026-10-06 and reverted) reads too faint. (tea is left out: it has no Mark tier.)
 *
 * On the hue wheel (red 0, org 1, yel 2, grn 3, blu 4, pur 5) three of the six jumps —
 * wrap from stroke 6 back to stroke 7 included — are complements (3 steps). The one
 * near-neighbour pair, grn→blu, is a deliberate design choice (2026-10-06). The palest
 * hue, yel, sits last so the shortest characters never use it.
 *
 *   red → grn → blu → org → pur → yel → (red)
 *      3     1     3     2     3     2
 */
const STROKE_HUES: readonly RampHue[] = ["red", "grn", "blu", "org", "pur", "yel"];
/** The fill of stroke i (0-based) in the colored state; wraps after six strokes. */
export const strokeColor = (i: number) => RAMP[STROKE_HUES[i % STROKE_HUES.length]].mark;
