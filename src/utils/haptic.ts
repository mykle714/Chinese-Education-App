/**
 * A single, very short vibration — confirmation that a hidden gesture landed, without
 * drawing any attention to it. Best effort: the Vibration API exists on Android
 * browsers/WebViews but not on iOS Safari or desktop, where this silently does nothing.
 * (The app has no native haptics plugin; if one is added, route it through here.)
 *
 * Referenced by: docs/SORT_CARDS_REQUIREMENTS.md §5.1a (SortCardsPage's Skip-button hold).
 */
export function quietHaptic(): void {
    try {
        navigator.vibrate?.(10);
    } catch {
        // Some embedded browsers throw instead of no-op'ing (e.g. without a user
        // activation). A missing buzz is never worth an error.
    }
}
