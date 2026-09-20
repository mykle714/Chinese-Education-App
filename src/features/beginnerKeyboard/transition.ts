/**
 * The one description of how the beginner keyboard travels.
 *
 * LAYER: client feature constants + a consumer hook. Deliberately separate from
 * both the host (which paints the surface) and the inset context (which carries
 * the measurement), because BOTH of them, and every page that reserves space for
 * the keyboard, must agree on the same durations and curves.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY A PAGE HAS TO KNOW ABOUT THIS AT ALL
 *
 * The keyboard is portaled over the app, so it cannot push anything: a page with
 * something pinned to the bottom reserves the space itself, off the inset context
 * (see insetContext.ts for why that is opt-in). The inset is a plain number that
 * changes in one step, so before this existed the immersive-world composer JUMPED
 * to its final position in a single frame while the keyboard spent a third of a
 * second sliding up behind it — the two read as unrelated events rather than one
 * surface arriving.
 *
 * So a page that reserves the space also borrows the timing, and the two move
 * together. `useBeginnerKeyboardTransition` picks the direction from the inset
 * itself (a non-zero inset can only mean the keyboard is arriving), so a caller
 * never has to track open/closed on its own.
 */
import { useBeginnerKeyboardInset } from './insetContext';

/**
 * Slide durations in ms.
 *
 * Exit is the quicker of the two: getting out of the way should feel immediate,
 * whereas arriving over the learner's content should not.
 */
export const BEGINNER_KEYBOARD_SLIDE_MS = { enter: 300, exit: 220 };

/**
 * Curves, matched to the MUI transition tokens `Slide` uses by default — `easeOut`
 * on the way in, `sharp` on the way out. Spelled literally rather than read off
 * the theme so a plain-CSS consumer can use the same values.
 */
export const BEGINNER_KEYBOARD_EASING = {
  enter: 'cubic-bezier(0.0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 0.6, 1)',
};

/** True when the OS has been told to keep motion down. Safe before the DOM exists. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A CSS `transition` value for a property that must travel with the keyboard.
 *
 * Pass whichever property is carrying the reserved space — usually
 * `padding-bottom` or `height`. Returns `'none'` for a reduced-motion account, so
 * the property snaps in the same frame the keyboard does.
 */
export function useBeginnerKeyboardTransition(property = 'padding-bottom'): string {
  const inset = useBeginnerKeyboardInset();
  if (prefersReducedMotion()) return 'none';
  // A non-zero inset can only mean the keyboard is on its way in; the provider
  // zeroes it the moment the exit STARTS, precisely so this stays true.
  const arriving = inset > 0;
  const ms = arriving ? BEGINNER_KEYBOARD_SLIDE_MS.enter : BEGINNER_KEYBOARD_SLIDE_MS.exit;
  const easing = arriving ? BEGINNER_KEYBOARD_EASING.enter : BEGINNER_KEYBOARD_EASING.exit;
  return `${property} ${ms}ms ${easing}`;
}
