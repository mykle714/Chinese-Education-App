/**
 * footerChrome.ts — the slab footer's colours (and the Menu popover raised from it),
 * keyed on the Settings colour THEME, never on the time of day.
 *
 * The footer is always the cream card stock (COLORS.cardFace on a cardWall lip, the
 * cardBeige selector) unless the learner picks the Dark theme in Settings, in which case it
 * is the slate set below on every page. Until 2026-11-15 it read the Tier 2 time-of-day
 * look (src/timeOfDay/tier2Chrome.ts) and turned slate at night over the Dictionary; the
 * owner asked for the footer never to go dark on its own.
 *
 * The channel is CSS custom properties on the document root (the same route
 * tier2Chrome.ts and components/footerCastShadow.ts use), so the styled components stay
 * static and nothing re-renders on a theme change. Each reader writes
 * `footerVar(key, itsOwnLightDefault)`; on the Light theme the variables are unset and
 * every reader falls back to its light value, so only the dark set is ever written.
 *
 * ⚠️ OUTSIDE THE COLOUR FRAMEWORK, on purpose: the framework has no dark tier yet (D4,
 * docs/SHELF_REDESIGN.md). The dark values are the Tower Tier 2 design's night slate
 * (`.t2n` — the same hexes tier2Look.ts → DARK_SURFACES uses for the Dictionary at night).
 *
 * Layer: shared theme module. Writer: contexts/ThemeContext.tsx (ThemeContextProvider).
 * Readers: components/MobileFooter.tsx, components/menuPopover/MenuPopover.tsx.
 * Docs: docs/SHELF_REDESIGN.md § 7b "Time of day", docs/DECK_TOWER.md (the slab footer).
 */

export interface FooterChrome {
    /** The slab's face and its diagonal lip. */
    face: string;
    wall: string;
    /** The active tab's sliding selector. */
    key: string;
    /** The selector's 1px outline (CLAUDE.md § Buttons & cards). */
    outline: string;
    /** Tab labels/icons: idle and active. */
    ink: string;
    inkActive: string;
}

export type FooterChromeKey = keyof FooterChrome;

/** The Dark theme's footer: the design's night slate. */
export const FOOTER_CHROME_DARK: FooterChrome = {
    face: "#2A3446",
    wall: "#121822",
    key: "#1E2735",
    outline: "rgba(255, 255, 255, 0.12)", // design `--olc`
    ink: "#A3AABB", // design `.t2n … .ft div`
    inkActive: "#EEF0F6",
};

/** `inkActive` → `--footer-ink-active`. */
const varName = (key: FooterChromeKey) => `--footer-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** A CSS value that reads the footer's themed colour, or `fallback` (the light value) when unset. */
export function footerVar(key: FooterChromeKey, fallback: string): string {
    return `var(${varName(key)}, ${fallback})`;
}

/** Writes the dark set to the root when `dark`, otherwise clears it so readers fall back to light. */
export function applyFooterChrome(dark: boolean): void {
    const root = document.documentElement.style;
    for (const key of Object.keys(FOOTER_CHROME_DARK) as FooterChromeKey[]) {
        if (dark) root.setProperty(varName(key), FOOTER_CHROME_DARK[key]);
        else root.removeProperty(varName(key));
    }
}
