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

/**
 * The switch bar's own slide, which is deliberately NOT the keyboard's.
 *
 * The bar starts parked behind the keyboard's top edge and is pushed out by it,
 * so it must not travel at the same time: it waits until the keyboard is nearly
 * home, then clears in half the time. Matching the keyboard's 300ms instead would
 * have had a bar crawling up a surface that was still moving, and matching its
 * VELOCITY would have snapped the bar into place 40ms in, long before the
 * keyboard it is supposed to be riding.
 *
 * Exit has no delay: the bar ducks back behind the keyboard first, and the
 * keyboard leaves over it.
 */
export const KEYBOARD_SWITCH_BAR_SLIDE_MS = { delay: 200, enter: 150, exit: 150 };

/** True when the OS has been told to keep motion down. Safe before the DOM exists. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A CSS `transition` value for a property carrying a keyboard's reserved space.
 *
 * Pure, and takes the inset rather than reading one, because there is now more
 * than one inset a page can be travelling on (`useKeyboardInset` unions ours with
 * the OS keyboard's). Both hooks below are this function plus a source, so the
 * durations and curves cannot drift apart between them.
 *
 * Returns `'none'` for a reduced-motion account, so the property snaps in the
 * same frame the keyboard does.
 */
export function transitionForInset(inset: number, property = 'padding-bottom'): string {
  if (prefersReducedMotion()) return 'none';
  // A non-zero inset can only mean a keyboard is on its way in; the provider
  // zeroes it the moment the exit STARTS, precisely so this stays true.
  const arriving = inset > 0;
  const ms = arriving ? BEGINNER_KEYBOARD_SLIDE_MS.enter : BEGINNER_KEYBOARD_SLIDE_MS.exit;
  const easing = arriving ? BEGINNER_KEYBOARD_EASING.enter : BEGINNER_KEYBOARD_EASING.exit;
  return `${property} ${ms}ms ${easing}`;
}

/**
 * The transition for a page reserving space for OUR keyboard only. Prefer
 * `useKeyboardTransition` unless the page genuinely wants to ignore the OS
 * keyboard.
 */
export function useBeginnerKeyboardTransition(property = 'padding-bottom'): string {
  return transitionForInset(useBeginnerKeyboardInset(), property);
}

/**
 * The `transform` transition for the switch bar, given whether it is on its way
 * out of its slot (`up`) or ducking back behind the keyboard.
 *
 * Lives here rather than in the bar because this module is the one description of
 * how this feature's surfaces travel, and the bar's timing is defined in terms of
 * the keyboard's — a change to one is a decision about the other.
 */
export function switchBarTransition(up: boolean): string {
  if (prefersReducedMotion()) return 'none';
  return up
    ? `transform ${KEYBOARD_SWITCH_BAR_SLIDE_MS.enter}ms ${BEGINNER_KEYBOARD_EASING.enter} ${KEYBOARD_SWITCH_BAR_SLIDE_MS.delay}ms`
    : `transform ${KEYBOARD_SWITCH_BAR_SLIDE_MS.exit}ms ${BEGINNER_KEYBOARD_EASING.exit}`;
}
