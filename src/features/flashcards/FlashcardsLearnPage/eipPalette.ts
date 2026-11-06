import { COLORS } from "../../../theme/colors";
import { mixHex } from "../../../theme/shadeHex";
import type { ThemeMode } from "../../../contexts/ThemeContext";

/**
 * eipPalette.ts — the eip's colours for the app's colour THEME (Settings → Theme, the
 * `ThemeMode` in src/contexts/ThemeContext.tsx). Two palettes:
 *   LIGHT — every theme but Dark (Light, Ocean, Nature). The Tower Tier 2 design's Day
 *           artboard: a pale-sky upper panel over the app's day keys, shelf and ink.
 *   DARK  — the Dark theme. The design's "Night–inverted" artboard: slate panels, light ink.
 *
 * Until 2026-11-05 these were the DAY and NIGHT palettes and the eip followed the learner's
 * time of day (the Deck Tower's clock, src/timeOfDay/useDayClock), blending across each
 * twilight. That read as the eip dimming in daylight, and the eip is a reading surface, so
 * the clock was dropped: the eip now changes only when the learner changes the theme. The
 * Deck Tower, the Dictionary page and acp still follow the clock.
 *
 * Layer: feature logic (src/features/flashcards). Pure — `useEipPalette` reads the theme
 * mode and hands the result to `EipPaletteProvider`.
 *
 * ── The two panels ────────────────────────────────────────────────────────────
 * The eip is two stacked panels (docs/EIP_SHEET_GESTURES.md § Telescope):
 *   UPPER — the tinted `ground`: More Info row, word trail, entry header. Its raised keys
 *           (the headword tile, the Add key) are `face` on an `edge` lip; its sunken
 *           controls (the sense chip) are `well` with a `wellShadow` lip.
 *   LOWER — the `shelf`: the content tabs (a sunken `tabWell` with a `tabOn` chip) and the
 *           tab body, whose example / breakdown cards are `card`.
 *
 * ── What the theme changes ────────────────────────────────────────────────────
 *   LIGHT tints only the UPPER panel's ground and wells — a pale tint of the tower's sky.
 *   Keys, the shelf and the ink are the app's light colours.
 *   DARK inverts the whole panel: slate panels, light ink, inner cards a lifted slate.
 *
 * ⚠️ OUTSIDE THE COLOUR FRAMEWORK, on purpose (the same divergence as the tower's
 * `NIGHT_SKY`): the framework has no dark tier (nor a pale-sky ground), so the light
 * grounds and the whole dark palette are the design's own values. Light keys, ink and lines
 * DO come from COLORS; each substitution of a design value by its nearest token is noted
 * beside it. Nor is the dark palette derived from ThemeContext's own 'dark' theme, which is
 * still underived (docs/SHELF_REDESIGN.md decision D4).
 *
 * Depends on: theme/colors.ts, theme/shadeHex.ts (`mixHex`), contexts/ThemeContext.tsx (`ThemeMode`, type only).
 * Depended on by: useEipPalette.ts, EipPaletteContext.tsx.
 * Docs: docs/EIP_SHEET_GESTURES.md § "Light / dark theme".
 */

export interface EipPalette {
    /** UPPER panel ground (and the sheet's own background behind it). */
    ground: string;
    /** Sunken control in the upper panel (the sense chip). */
    well: string;
    /** The sunken control's 2px inner top lip. */
    wellShadow: string;
    /** Raised key fill (headword tile, Add key). */
    face: string;
    /** The raised key's solid drop lip. */
    edge: string;
    /** LOWER panel (tab shelf + tab body). */
    shelf: string;
    /** The shelf's own grabber pill. */
    shelfGrab: string;
    /** The content tabs' sunken track, and its 2px inner top lip. */
    tabWell: string;
    tabWellShadow: string;
    /** The selected content tab's chip. */
    tabOn: string;
    /** Inner cards in the tab body (example sentences, breakdown rows). */
    card: string;
    /** Text and icons: primary, secondary (icons), muted (labels, inactive tabs). */
    ink: string;
    ink2: string;
    muted: string;
    /** Hairlines and card outlines. */
    line: string;
    /** True for the dark palette (light ink) — hosts swap the flashcard theme palette on this. */
    dark: boolean;
}

// ── Light keys, shelf and ink ──────────────────────────────────────────────────
const LIGHT_BASE = {
    face: COLORS.white,
    // Design `--edge` #E2E2E6 → COLORS.grey #E7E7EA (nearest token; 2% lighter).
    edge: COLORS.grey,
    shelf: COLORS.white,
    // Design #D2D2D8 — no token is close (grey #E7E7EA is too faint to read on white,
    // greyA #A4A4A9 too dark). Design value kept; flagged in docs/EIP_SHEET_GESTURES.md.
    shelfGrab: "#D2D2D8",
    tabOn: COLORS.white,
    card: COLORS.white,
    ink: COLORS.onSurface,
    ink2: COLORS.iconColor,
    muted: COLORS.textSecondary,
    // Design `--line` rgba(23,22,26,.08) → COLORS.rowBorder (0.10).
    line: COLORS.rowBorder,
    dark: false,
} as const;

/** The content tabs' track: the upper well mixed 45% into white (design `.tabw .tabs`). */
const tabTrack = (well: string, wellShadow: string) => ({
    tabWell: mixHex(COLORS.white, well, 0.45),
    tabWellShadow: mixHex(COLORS.white, wellShadow, 0.45),
});

const LIGHT_PALETTE: EipPalette = {
    // `.t2a` — pale sky. Authored oklch, shipped as the clamped hex (colors.ts rule).
    ...LIGHT_BASE,
    ground: "#E0F3FF", // oklch(95.5% 0.028 238)
    well: "#D1EAFC", // oklch(92.5% 0.036 238)
    wellShadow: "#BDDDF2", // oklch(88% 0.045 238)
    ...tabTrack("#D1EAFC", "#BDDDF2"),
};

// `.t2n.t2ni` — the design's Night–inverted artboard: everything slate, light ink.
const DARK_PALETTE: EipPalette = {
    ground: "#2A3446",
    well: "#1E2735",
    wellShadow: "#141A24",
    face: "#1E2735",
    edge: "#121822",
    shelf: "#1E2735",
    shelfGrab: "#56627A",
    tabWell: "#141A24",
    tabWellShadow: "#0E131B",
    tabOn: "#2A3446",
    card: "#2A3446",
    ink: "#EEF0F6",
    ink2: "#C3C8D6",
    muted: "#8F97AA",
    line: "rgba(255, 255, 255, 0.1)",
    dark: true,
};

/** The palette the light (non-Dark) themes use — also the default outside a provider. */
export const EIP_LIGHT_PALETTE = LIGHT_PALETTE;

/** The eip's palette for a theme: the dark palette for Dark, the light one for every other. */
export function eipPaletteFor(mode: ThemeMode): EipPalette {
    return mode === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
}
