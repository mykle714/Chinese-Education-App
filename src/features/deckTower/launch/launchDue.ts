/**
 * launchDue — whether this td mount should open behind the LAUNCH SCREEN
 * (docs/LAUNCH_SCREEN.md § "When it shows").
 *
 * The launch screen shows ONCE PER APP LAUNCH (one JS session: a cold start or a reload), and
 * only when the launch itself landed on td (`/`). A launch that deep-links somewhere else
 * (`/dictionary`, a cdp, `/arena`) never shows it later, when the learner taps the Flashcards
 * tab: that is navigation, not an app open.
 *
 * "Landed on td" reads the DOCUMENT's own URL (the navigation timing entry), which no SPA
 * route change rewrites. `window.location` is not used: by the time the lazily-loaded td
 * module runs it may already be a later route.
 *
 * (This logic decided when the home screen showed until 2026-11-11, when the home screen was
 * archived (docs/ARCHIVED_FEATURES.md) and the launch screen took its place.)
 *
 * Layer: feature page logic (src/features/deckTower/launch). Pure module state, no React.
 * Depended on by: DeckTowerPage.tsx (`launchDueOnMount` read once per mount, `markLaunchTaken` on mount).
 */

/** Set once the launch screen has been taken (td mounted with it due). */
let launchTaken = false;

/** The pathname the document was loaded at; `/` when the timing API is missing. */
function launchPathname(): string {
    try {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (nav?.name) return new URL(nav.name).pathname;
    } catch {
        // An old WebView without Navigation Timing L2: fall through to the safe default.
    }
    return "/";
}

/** Read once at module load: the launch either opened on td or it did not. */
const LAUNCHED_ON_TD = launchPathname() === "/";

/**
 * Whether td should open behind the launch screen. PURE (a read) so it is safe as a
 * `useState` initializer, which StrictMode may call twice; the page calls `markLaunchTaken`
 * from an effect once it has mounted with the answer.
 */
export function launchDueOnMount(): boolean {
    return LAUNCHED_ON_TD && !launchTaken;
}

/** The launch screen is spent: every later td mount opens straight on the tower. */
export function markLaunchTaken(): void {
    launchTaken = true;
}
