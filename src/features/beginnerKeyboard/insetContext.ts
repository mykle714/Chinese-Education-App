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
 * The keyboard is portaled into the frame-level overlay host (`frameOverlayHost`), so
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
 *
 * ⚠️ THIS IS OUR SURFACE ONLY, AND A RESERVING PAGE PROBABLY WANTS MORE. Since the
 * switch bar (§ 6z-2) this is NOT zero after the `ABC` key: the bar stays up
 * perched on the OS keyboard, and the host reports its height plus that perch — so
 * in that state our number happens to be the whole occlusion. But it IS still 0 on
 * a field the keyboard declines (`data-beginner-keyboard="off"`), where no host
 * mounts at all and the OS keyboard covers the same pinned controls unannounced.
 * Reserve off `useKeyboardInset()` (`useKeyboardInset.ts`), which unions the two;
 * read this one only when a page genuinely means to ignore that case. The CSS
 * variable carries OUR number, not the union.
 */
import { createContext, useContext } from 'react';

/** The CSS custom property carrying the same number, for non-React consumers. */
export const INSET_CSS_VARIABLE = '--beginner-keyboard-inset';

/**
 * Occupied height in CSS px, measured from the bottom of the app: our whole
 * surface (switch bar + keyboard) while the handwriting keyboard is up, the bar
 * plus the OS keyboard it is perched on after the `ABC` key, and 0 when no
 * eligible field is focused.
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
