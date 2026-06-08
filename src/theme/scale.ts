// Type scale + weight / leading / tracking tokens.
//
// Sizes are expressed in `rem` (root = 16px) so they respect the user's
// browser font-size preference. The px equivalents in comments are what the
// previous ad-hoc inline values snapped to during consolidation.

/** Font sizes — 9 steps. Values are sx-ready strings. */
export const SIZE = {
    micro: "0.6875rem",            // 11px — tiny badge counters
    caption: "0.75rem",            // 12px — metadata, captions, POS badges
    body: "0.875rem",              // 14px — DEFAULT body text
    bodyLg: "1rem",                // 16px — inputs, emphasized body
    subtitle: "1.125rem",          // 18px — sub-headers, list titles
    title: "1.375rem",             // 22px — card / section titles
    heading: "1.75rem",            // 28px — page titles
    display: "2.5rem",             // 40px — hero numbers, big stats
    hero: "clamp(3rem, 14vw, 9rem)", // 48–144px — giant headword character
} as const;

/** Font weights — numerics only (no 'bold'/'medium' string forms). */
export const WEIGHT = {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
} as const;

/** Line heights — unitless multipliers. */
export const LEADING = {
    none: 1,        // single-line labels, display
    tight: 1.2,     // headings
    normal: 1.5,    // body
    relaxed: 1.6,   // long-form definitions / paragraphs
} as const;

/** Letter spacing. */
export const TRACKING = {
    normal: 0,
    wide: "0.02em",   // buttons, small labels
    caps: "0.12em",   // UPPERCASE overlines
} as const;

export type SizeToken = keyof typeof SIZE;
