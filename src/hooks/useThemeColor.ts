import { useEffect } from "react";
import { COLORS } from "../theme/colors";

/**
 * THEME COLOR — keeps the BROWSER CHROME the same colour as whatever the app is
 * painting under it.
 *
 * WHY THIS EXISTS: in a browser TAB the band around the page — Android Chrome's
 * toolbar, and the strip behind the clock/battery on iOS Safari — is drawn by the
 * browser, not by the page, and it takes its colour from `<meta name="theme-color">`
 * (falling back to the document background). Nothing in the React tree can paint it.
 * So a game that floods its `LeafPage` with its hue's ground used to sit under a
 * paper-white strip. This hook is the bridge: a component says what colour the ground
 * is, and the meta tag follows it.
 *
 * ⚠️ WHAT THIS HOOK DOES **NOT** FIX: the iOS HOME-SCREEN web app. There the status
 * bar was never a `theme-color` surface at all — while the web view was letterboxed
 * inside the safe area, iOS filled the band itself using the document background it
 * captured at LAUNCH, so every runtime write here (meta tag or documentElement) was
 * ignored and the strip stayed paper-white on games and pages alike. That is fixed
 * OUTSIDE this hook, by `viewport-fit=cover` PLUS
 * `apple-mobile-web-app-status-bar-style: black-translucent` in index.html (it takes
 * both — `cover` alone leaves the app letterboxed and the insets at 0px) + the
 * safe-area insets in src/theme/safeArea.ts, which make the band page pixels painted
 * by the surface itself. This hook remains correct and useful for Safari tabs and Android Chrome —
 * it is simply not the mechanism the standalone app uses.
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
 * A claim writes FOUR places, all describing the same ground: the meta tag (browser
 * chrome), `documentElement`'s background (Safari's overscroll area), the
 * `--surface-ground` variable (MobileDemoFrame's frame ground, and on mobile `body`'s
 * background, the tint of the iOS home-screen app's status-bar fade), and
 * `documentElement`'s `color-scheme` (see `schemeFor`).
 *
 * Layer: presentational (a document-level side effect, like `usePageTitle`).
 * Callers: `GameSurfaceProvider` (src/games/shared/GameSurface.tsx) — every game page
 * gets this for free through `GameLeafPage`, which is what makes the header and the
 * status bar impossible to leave out of sync.
 * `MasteryCenterPage` and `DivisionBanner` claim the ground they paint under the clock;
 * `SheetPanel` claims its own surface while fully merged (`claimThemeColor`).
 * `DeckTowerPage` (src/features/deckTower) claims its world's sky, so iOS Safari's
 * top scroll-edge effect is tinted sky rather than paper, and a night sky flips the
 * home-screen app's clock to white (docs/DECK_TOWER.md § "Status-bar band").
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

/**
 * WCAG relative luminance of a `#rgb` / `#rrggbb` colour, or null for anything else
 * (an `rgb()` / named colour falls back to the light scheme rather than guessing).
 */
function relativeLuminance(color: string): number | null {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!m) return null;
    const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    const [r, g, b] = [0, 2, 4].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The `color-scheme` a ground wants: `dark` when WHITE glyphs contrast with it better
 * than black ones (WCAG contrast; the two are equal at luminance ≈ 0.179).
 *
 * WHY: in the iOS home-screen app (`black-translucent`, index.html) the app cannot pick
 * the clock/battery colour directly. This was shipped to turn the white status-bar fade
 * dark over a night sky, and it did NOT: forcing `color-scheme` on device (dark or normal)
 * left the fade white (2026-10-30). The fade's tint is `body`'s background — see
 * `applyTopClaim`'s `--surface-ground` note. Whether this still changes the GLYPHS is untested.
 *
 * Side effect, by design limited to while a dark ground is claimed: native form
 * controls and scrollbars render dark. Text is unaffected — `:root` sets `color`
 * explicitly (src/index.css), so nothing inherits the dark scheme's default ink.
 */
function schemeFor(color: string): "light" | "dark" {
    const l = relativeLuminance(color);
    if (l === null) return "light";
    // Contrast vs white: 1.05 / (l + .05); vs black: (l + .05) / .05.
    return 1.05 / (l + 0.05) > (l + 0.05) / 0.05 ? "dark" : "light";
}

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

    // The frame's own ground follows the claim too, so any sliver the page does not
    // itself cover — a bounce, a sub-pixel seam, a transition's first frame — shows the
    // current surface rather than paper. (Until 2026-09-13 this also backstopped a
    // deliberately reserved strip at the bottom of the iOS home-screen app; that strip
    // turned out to be the bug rather than a necessity and is gone — see
    // src/hooks/useAppHeight.ts.) Published as a CSS
    // variable rather than pushed through React state because the frame is a styled
    // component far above every claimant, and this way a claim repaints it without
    // re-rendering the tree.
    //
    // `body` reads this variable too, on mobile only: in the iOS home-screen app the fade
    // behind the clock (which stays; this only recolours it) takes its tint from body's
    // background, even though the shell covers body completely. Every flooded ground wore
    // a pale fade until body followed (device probes, 2026-10-30,
    // docs/IOS_STATUS_BAR_BUG.md round 8). Desktop body is the backdrop around the phone
    // card and must not follow, so the rule is a media query in ThemeContext's
    // `MuiCssBaseline` override, not a write here.
    document.documentElement.style.setProperty("--surface-ground", color);

    // Safari also uses the DOCUMENT background for the overscroll/rubber-band area at
    // the top and bottom edges, which `theme-color` does not cover. Painting the root
    // keeps a bounce from flashing paper under a saturated game ground. The app shell
    // itself never scrolls (see index.css), so this only ever shows during a bounce.
    document.documentElement.style.backgroundColor = color;

    // Status-bar glyph scheme; see `schemeFor`. Cleared, not set to "light", when unclaimed, so index.css's
    // `:root { color-scheme: light }` stays the one source of the default.
    const scheme = claims.length > 0 ? schemeFor(color) : null;
    if (scheme === "dark") document.documentElement.style.colorScheme = "dark";
    else document.documentElement.style.removeProperty("color-scheme");
}

/**
 * Claim `color` outside React's lifecycle; returns the release. For a surface whose
 * ownership of the top of the screen changes mid-gesture with no re-render: SheetPanel's
 * merge. Everything else should use `useThemeColor`.
 */
export function claimThemeColor(color: string): () => void {
    const claim: ThemeColorClaim = { color };
    claims.push(claim);
    applyTopClaim();
    return () => {
        const i = claims.indexOf(claim);
        if (i !== -1) claims.splice(i, 1);
        applyTopClaim();
    };
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
        return claimThemeColor(color);
    }, [color]);
}
