import type { Tier2Look } from "./tier2Look";

/**
 * tier2Chrome.ts — hands a Tier 2 page's time-of-day look (tier2Look.ts) to the chrome
 * drawn OUTSIDE the page: the slab footer (MobileFooter, rendered at frame level by
 * FooterPresenter) and the beginner keyboard (BeginnerKeyboardHost, mounted app-wide).
 *
 * The channel is a set of CSS custom properties on the document root — the same route the
 * Deck Tower uses for the slab's cast shadow (components/footerCastShadow.ts) — so neither
 * piece of chrome needs to know which page is under it, and nothing re-renders when the
 * clock ticks. Each reader writes `tier2Var(key, itsOwnDefault)`: while no Tier 2 page is
 * up the variables are unset and every reader falls back to the look it always had. That
 * is what makes the keyboard tint "only on Tier 2 pages" (owner's choice 2026-10-29).
 *
 * CLAIMS ARE COUNTED. Two Tier 2 pages can be mounted at once mid-transition (Dictionary →
 * its card page slides in over it), and the leaving page unmounts AFTER the entering one
 * has written its look; clearing on every unmount would wipe the newcomer's. So each page
 * claims on mount, and the variables are removed only when the last claim is released.
 *
 * Layer: shared module (`src/timeOfDay/`). Depended on by: useTier2Look.ts (writer);
 * components/MobileFooter.tsx, components/CpcdPopup.tsx, features/beginnerKeyboard/* (readers).
 * Docs: docs/SHELF_REDESIGN.md § 7b "Time of day".
 */

/** The look's colour fields — everything but the `dark` flag. */
export type Tier2ChromeKey = Exclude<keyof Tier2Look, "dark">;

/** `surfaceEdge` → `--tier2-surface-edge`. */
const varName = (key: Tier2ChromeKey) => `--tier2-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** A CSS value that reads the Tier 2 page's colour, or `fallback` when no Tier 2 page is up. */
export function tier2Var(key: Tier2ChromeKey, fallback: string): string {
    return `var(${varName(key)}, ${fallback})`;
}

let claims = 0;
let writtenKeys: Tier2ChromeKey[] = [];

/** Registers a mounted Tier 2 page. Returns its release. */
export function claimTier2Chrome(): () => void {
    claims += 1;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        claims -= 1;
        if (claims === 0) clearTier2Chrome();
    };
}

/** Writes `look` to the root. Only values that changed are written (a root write restyles the whole document). */
export function writeTier2Chrome(look: Tier2Look): void {
    const root = document.documentElement.style;
    const keys = (Object.keys(look) as (keyof Tier2Look)[]).filter((k): k is Tier2ChromeKey => k !== "dark");
    for (const key of keys) {
        const name = varName(key);
        if (root.getPropertyValue(name) !== look[key]) root.setProperty(name, look[key]);
    }
    writtenKeys = keys;
}

function clearTier2Chrome(): void {
    const root = document.documentElement.style;
    for (const key of writtenKeys) root.removeProperty(varName(key));
    writtenKeys = [];
}
