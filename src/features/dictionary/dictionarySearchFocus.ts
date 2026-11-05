// Double-tap the footer's Dictionary tab → focus the dictionary search field.
//
// A single tap only navigates (the page does not auto-focus on visit — removed
// 2026-10-12, see DictionaryPage). A second tap within DOUBLE_TAP_WINDOW_MS is read
// as "I want to type": the footer calls `requestDictionarySearchFocus()`.
//
// Two delivery paths, because the second tap can land before or after the page mounts:
//   • Page already mounted (the usual case — the first tap navigated and the lazy
//     chunk is loaded): the page's registered handler focuses the field
//     SYNCHRONOUSLY, inside the tap's click handler. That matters on iOS, which only
//     raises the OS keyboard for a focus that happens inside a user gesture.
//   • Page not mounted yet (the chunk is still loading): the request is parked in
//     `pending` and the page consumes it on mount, deferred one frame so
//     BeginnerKeyboardProvider's close-on-pathname-change does not tear down the
//     keyboard the focus just raised (docs/BEGINNER_KEYBOARD.md § 6z-3a). iOS may not
//     raise the keyboard on this path; the field is still focused and the caret shown.
//
// Referenced by: src/components/MobileFooter.tsx → TABS (dictionary onClick),
// src/features/dictionary/DictionaryPage.tsx (focus registration effect),
// docs/NAVIGATION.md § footer tabs.

// Max gap between the two taps for them to count as a double tap.
export const DOUBLE_TAP_WINDOW_MS = 350;

type FocusHandler = () => void;

let handler: FocusHandler | null = null;
let pending = false;

/** Ask the dictionary page to focus its search field (now, or as soon as it mounts). */
export function requestDictionarySearchFocus(): void {
    if (handler) {
        handler();
        return;
    }
    pending = true;
}

/**
 * Registered by DictionaryPage while mounted. Returns the unregister function.
 * If a request was parked before the page mounted, it is reported back via
 * `hadPending` so the page can apply it (one frame later — see header comment).
 */
export function registerDictionarySearchFocus(fn: FocusHandler): { unregister: () => void; hadPending: boolean } {
    handler = fn;
    const hadPending = pending;
    pending = false;
    return {
        unregister: () => { if (handler === fn) handler = null; },
        hadPending,
    };
}

// Last Dictionary-tab tap time. Module-level rather than a ref in MobileFooter because
// the footer can remount between the two taps (FooterPresenter swaps bar ⇄ slab per route).
let lastDictionaryTabTapAt = 0;

/** Records a Dictionary-tab tap; true when it completes a double tap. */
export function registerDictionaryTabTap(now: number = Date.now()): boolean {
    const isDouble = now - lastDictionaryTabTapAt <= DOUBLE_TAP_WINDOW_MS;
    // A completed double tap resets the timer, so a triple tap is not two doubles.
    lastDictionaryTabTapAt = isDouble ? 0 : now;
    return isDouble;
}
