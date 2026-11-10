/**
 * homeLaunch — whether this td mount should open on the HOME stage (docs/HOME_SCREEN.md
 * § "When it shows").
 *
 * The home screen shows ONCE PER APP LAUNCH (one JS session — a cold start or a reload), and
 * only when the launch itself landed on td (`/`). A launch that deep-links somewhere else
 * (`/dictionary`, a cdp, `/arena`) never shows it later, when the learner taps the Deck tab:
 * that is navigation, not an app open.
 *
 * "Landed on td" reads the DOCUMENT's own URL (the navigation timing entry), which no SPA
 * route change rewrites — not `window.location`, which by the time the lazily-loaded td module
 * runs may already be a later route.
 *
 * Layer: feature page logic (src/features/deckTower/home). Pure module state, no React.
 * Depended on by: DeckTowerPage.tsx (`homeDueOnLaunch` read once per mount, `markHomeTaken` on mount).
 */

/** Set once the launch's home screen has been taken (td mounted with it due). */
let homeTaken = false;

/** The pathname the document was loaded at; `/` when the timing API is missing. */
function launchPathname(): string {
    try {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (nav?.name) return new URL(nav.name).pathname;
    } catch {
        // An old WebView without Navigation Timing L2 — fall through to the safe default.
    }
    return "/";
}

/** Read once at module load: the launch either opened on td or it did not. */
const LAUNCHED_ON_TD = launchPathname() === "/";

/**
 * Whether td should open on the home stage. PURE (a read) so it is safe as a `useState`
 * initializer, which StrictMode may call twice; the page calls `markHomeTaken` from an
 * effect once it has mounted with the answer.
 */
export function homeDueOnLaunch(): boolean {
    return LAUNCHED_ON_TD && !homeTaken;
}

/** The launch's home screen is spent: every later td mount opens straight on the tower. */
export function markHomeTaken(): void {
    homeTaken = true;
}
