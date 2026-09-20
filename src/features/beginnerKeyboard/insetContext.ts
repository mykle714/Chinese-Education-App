/**
 * How much of the screen the beginner keyboard is currently occupying, so a page
 * can give up that space instead of being covered by it.
 *
 * LAYER: client feature context. Published by `BeginnerKeyboardProvider`,
 * consumed by any page that has something pinned to the bottom.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 7a.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY PAGES OPT IN RATHER THAN THE KEYBOARD PUSHING THEM
 *
 * The keyboard is portaled into the app's overlay host (`nearestOverlayHost`), so
 * it is not in any page's layout flow and cannot shrink one by existing. That is
 * deliberate: most pages SCROLL, and a scrolling page handles an occluded bottom
 * correctly on its own — the caret is scrolled into view and nothing is lost.
 *
 * The pages that need this are the ones with something PINNED to the bottom that
 * scrolling cannot reveal: the immersive-world composer is the motivating case.
 * Making every page reserve the space would leave a band of dead layout under
 * surfaces that never needed it.
 *
 * Two ways to read it, for the two kinds of consumer:
 *   - `useBeginnerKeyboardInset()` for React layout (a padding, a height calc)
 *   - `--beginner-keyboard-inset` on :root for plain CSS
 * Both are written from the same measurement, so they cannot disagree.
 */
import { createContext, useContext } from 'react';

/** The CSS custom property carrying the same number, for non-React consumers. */
export const INSET_CSS_VARIABLE = '--beginner-keyboard-inset';

/**
 * Occupied height in CSS px: the keyboard's measured height while it is up, and 0
 * when no eligible field is focused or the learner has taken the OS keyboard back
 * with the `ABC` key.
 */
export const BeginnerKeyboardInsetContext = createContext(0);

/**
 * Space the beginner keyboard is taking at the bottom of the screen.
 *
 * Returns 0 outside the provider, so a page reading it is safe in tests and in
 * any tree that does not mount the keyboard.
 */
export function useBeginnerKeyboardInset(): number {
  return useContext(BeginnerKeyboardInsetContext);
}
