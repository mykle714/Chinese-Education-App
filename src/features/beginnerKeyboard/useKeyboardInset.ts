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
 * zero on a field marked `data-beginner-keyboard="off"`, or for a learner the
 * keyboard does not serve (Spanish), where the keyboard declines to mount at all
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
import { useKeyboardViewport, type KeyboardViewport } from './useKeyboardViewport';
import { transitionForInset } from './transition';

/**
 * The CSS custom properties carrying {@link useKeyboardInset}'s union (and its
 * travel timing) on :root, for consumers that are plain CSS rather than React.
 * Published by `BeginnerKeyboardProvider`, which is mounted app-wide for every
 * learner (the handwriting keyboard's own gates do not apply to this number —
 * a Spanish learner's OS keyboard is reported here too).
 *
 * Consumers (keep current):
 *   • src/contexts/ThemeContext.tsx — `MuiDialog.styleOverrides.root`: every
 *     MUI Dialog re-centres in the space above the keyboard. Spelled as a literal
 *     there (the shared theme does not import from a feature).
 *
 * Unlike `--beginner-keyboard-inset` (insetContext.ts), this one is the UNION —
 * prefer it for anything that must not be covered.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 7a-3; docs/UX_AND_NAVIGATION.md § Keyboard
 * and popups.
 */
export const KEYBOARD_INSET_CSS_VARIABLE = '--keyboard-inset';
export const KEYBOARD_INSET_TIMING_CSS_VARIABLE = '--keyboard-inset-timing';

/**
 * The union itself, pure, so the provider (which cannot read its own context
 * through {@link useKeyboardInset}) computes the published CSS variable from the
 * exact same rule the hook uses.
 */
export function unionKeyboardInset(ours: number, viewport: KeyboardViewport): number {
  return Math.max(ours, viewport.osKeyboardVisible ? viewport.height : 0);
}

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
  return unionKeyboardInset(ours, viewport);
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
