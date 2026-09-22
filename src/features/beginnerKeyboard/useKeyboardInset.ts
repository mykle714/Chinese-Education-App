/**
 * useKeyboardInset — how much bottom screen space ANY keyboard is taking.
 *
 * LAYER: client feature hook. The union of the two answers this feature already
 * owns separately, so a page that has to give up the space asks one question
 * instead of two.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 7a.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY THE OS KEYBOARD NEEDED ITS OWN ANSWER
 *
 * `useBeginnerKeyboardInset` reports OUR surface, and it is correct — but it is
 * zero on a field marked `data-beginner-keyboard="off"` (the immersive world's
 * dictionary tray is exactly that), where the keyboard declines to mount at all
 * and the plain OS keyboard covers the same pinned controls our own keyboard was
 * carefully moved above. `useKeyboardViewport` already measures where the OS
 * keyboard is (it has to, to size our surface to match); this just publishes that
 * measurement to the pages that also need it.
 *
 * ⚠️ The `ABC` state used to be a second zero case and no longer is: the switch
 * bar (§ 6z-2) stays up over the OS keyboard, so the host reports the bar plus the
 * perch under it. Ours is then the LARGER of the two answers, which is why max —
 * see below — still returns the right number rather than losing the bar.
 *
 * `Math.max` rather than a sum: the two are mutually exclusive as OCCLUSIONS
 * (`BeginnerKeyboardHost` suppresses the OS keyboard with `inputMode="none"` for
 * as long as ours is up, and where both are up ours already contains the OS
 * height), and max is what keeps the handover between them from flickering
 * through a doubled or a zero inset mid-swap.
 */
import { useBeginnerKeyboardInset } from './insetContext';
import { useKeyboardViewport } from './useKeyboardViewport';
import { transitionForInset } from './transition';

/**
 * Occupied height at the bottom of the screen in CSS px — ours or the OS's,
 * whichever is up, and 0 when neither is.
 *
 * ⚠️ `KeyboardViewport.height` is a SIZE HINT, not an occlusion: it falls back to
 * a default so our surface never collapses to nothing on a desktop with a
 * hardware keyboard. Only `osKeyboardVisible` makes it a real occlusion, which is
 * why it is gated rather than read straight.
 */
export function useKeyboardInset(): number {
  const ours = useBeginnerKeyboardInset();
  const viewport = useKeyboardViewport();
  return Math.max(ours, viewport.osKeyboardVisible ? viewport.height : 0);
}

/**
 * The CSS `transition` a page should put on whatever property carries
 * {@link useKeyboardInset}, so the reserved space travels with the keyboard
 * rather than teleporting ahead of it.
 *
 * The same curve as `useBeginnerKeyboardTransition` and for the same reason; it
 * differs only in reading the combined inset, so an OS keyboard arriving picks
 * the ENTER timing rather than being mistaken for our own keyboard leaving.
 */
export function useKeyboardTransition(property = 'padding-bottom'): string {
  return transitionForInset(useKeyboardInset(), property);
}
