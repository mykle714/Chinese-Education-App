import { useEffect } from "react";
import { COLORS } from "../theme/colors";

/**
 * THEME COLOR — keeps the phone's status-bar strip the same colour as whatever the
 * app is painting under it.
 *
 * WHY THIS EXISTS: on iOS the band behind the clock/battery is drawn by the BROWSER,
 * not by the page, and it takes its colour from `<meta name="theme-color">` (falling
 * back to the document background). Nothing in the React tree can paint it. So a game
 * that floods its `LeafPage` with a saturated accent used to sit under a paper-white
 * strip — the ground stopped at the top of the app and the phone finished the screen
 * in a different colour. This hook is the bridge: a component says what colour the
 * ground under the status bar is, and the meta tag follows it.
 *
 * WHY A STACK, NOT A PLAIN SET/RESET: mounts and unmounts interleave. During a
 * `usePageSlide` exit the outgoing game page is still mounted while the destination
 * mounts beneath it, so a naive "restore the default on unmount" would let the
 * departing page clear the colour the arriving page just set. Entries are pushed on
 * mount and spliced out by identity on unmount, and the TOP of the stack always wins —
 * so whichever holder is still mounted keeps the strip, in any interleaving.
 *
 * The `<meta>` tag itself is declared in index.html with the paper default; this hook
 * only ever rewrites its `content`, and creates the tag only if it has gone missing.
 *
 * Layer: presentational (a document-level side effect, like `usePageTitle`).
 * Callers: `GameSurfaceProvider` (src/games/shared/GameSurface.tsx) — every game page
 * gets this for free through `GameLeafPage`, which is what makes the header and the
 * status bar impossible to leave out of sync.
 */

/** The colour the strip returns to when nothing is claiming it — the app's paper ground. */
const DEFAULT_THEME_COLOR = COLORS.background;

/**
 * Claim entries, oldest first. Each is a one-element box so an entry can be removed by
 * IDENTITY (`indexOf`) rather than by colour — two pages claiming the same colour must
 * not have one release the other's claim.
 */
type ThemeColorClaim = { color: string };
const claims: ThemeColorClaim[] = [];

/** Push the top-of-stack colour (or the default) into the meta tag. */
function applyTopClaim(): void {
    const color = claims.length > 0 ? claims[claims.length - 1].color : DEFAULT_THEME_COLOR;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
        // index.html ships one, but a stripped host document (or a test harness that
        // mounts the app into a bare DOM) may not have it. Create rather than no-op:
        // silently doing nothing here is exactly the bug this hook exists to fix.
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
    }
    meta.content = color;

    // Safari also uses the DOCUMENT background for the overscroll/rubber-band area at
    // the top and bottom edges, which `theme-color` does not cover. Painting the root
    // keeps a bounce from flashing paper under a saturated game ground. The app shell
    // itself never scrolls (see index.css), so this only ever shows during a bounce.
    document.documentElement.style.backgroundColor = color;
}

/**
 * Paint the browser's status-bar strip `color` for as long as the calling component is
 * mounted, then hand it back to whoever else still holds a claim (or to paper).
 *
 * Pass `null` to hold no claim — for a caller whose colour is conditional, so it does
 * not have to break the rules-of-hooks to opt out.
 */
export function useThemeColor(color: string | null): void {
    useEffect(() => {
        if (color === null) return;

        const claim: ThemeColorClaim = { color };
        claims.push(claim);
        applyTopClaim();

        return () => {
            const i = claims.indexOf(claim);
            if (i !== -1) claims.splice(i, 1);
            applyTopClaim();
        };
    }, [color]);
}
