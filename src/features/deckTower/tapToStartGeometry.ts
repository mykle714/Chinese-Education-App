/**
 * The Tap to Start hint's geometry (docs/DECK_TOWER.md § "Tap to Start"), in viewBox px: the
 * arrow and the line its words stand on, stacked up from the arrow's tip.
 *
 * Its own module so TapToStartHint.tsx exports only a component
 * (react-refresh/only-export-components), and so the home screen can put its "Swipe down to
 * enter" on the same line without importing the hint.
 *
 * Depended on by: TapToStartHint.tsx; home/HomeStage.tsx (`tapHintBaselineY`).
 * Docs: docs/DECK_TOWER.md § "Tap to Start"; docs/HOME_SCREEN.md § "The enter hint".
 */

/** Gap between the arrow's tip and the fit tower's top, in viewBox px. */
export const TIP_GAP = 10;
/** The arrow, in viewBox px: a thick shaft under a solid, wider head. */
export const SHAFT_LENGTH = 26;
export const SHAFT_WIDTH = 9;
export const HEAD_LENGTH = 22;
export const HEAD_WIDTH = 34;
/** Between the words' baseline and the shaft's top. */
export const TEXT_GAP = 10;

/**
 * The words' baseline (viewBox y) for an arrow tip aimed at `tipY`: the stack is built up
 * from the tip — gap, head, shaft, gap, words. Shared with the home screen, which paints its
 * "Swipe down to enter" on the same line (HomeStage).
 */
export const tapHintBaselineY = (tipY: number): number => tipY - TIP_GAP - HEAD_LENGTH - SHAFT_LENGTH - TEXT_GAP;
