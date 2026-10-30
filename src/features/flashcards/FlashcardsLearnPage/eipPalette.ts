import { COLORS } from "../../../theme/colors";
import { phaseShare, type DayPhase, type TimeOfDay } from "../../../timeOfDay/dayPhase";

/**
 * eipPalette.ts — the eip's colours for the learner's time of day (the Tower Tier 2
 * design, "Tower Tier 2 - Time of Day": artboards Dawn / Day / Sunset / Night–inverted).
 *
 * Layer: feature logic (src/features/flashcards). Pure — `useEipPalette` samples the shared
 * clock (src/timeOfDay/useDayClock) and hands the result to `EipPaletteProvider`.
 *
 * ── The two panels ────────────────────────────────────────────────────────────
 * The eip is two stacked panels (docs/EIP_SHEET_GESTURES.md § Telescope):
 *   UPPER — the tinted `ground`: More Info row, word trail, entry header. Its raised keys
 *           (the headword tile, the Add key) are `face` on an `edge` lip; its sunken
 *           controls (the sense chip) are `well` with a `wellShadow` lip.
 *   LOWER — the `shelf`: the content tabs (a sunken `tabWell` with a `tabOn` chip) and the
 *           tab body, whose example / breakdown cards are `card`.
 *
 * ── What a phase changes ──────────────────────────────────────────────────────
 *   DAWN / DAY / SUNSET change only the UPPER panel's ground and wells — a pale
 *   tint of the tower's sky at that hour. Keys, the shelf and the ink stay as by day.
 *   NIGHT inverts the whole panel (the design's "Night–inverted", chosen 2026-10-29):
 *   slate panels, light ink, inner cards a lifted slate.
 * Phases BLEND across the tower's 30-minute twilights (`eipPaletteAt`), so the eip and the
 * tower always agree on the hour. The INK cannot blend — a half-way grey on a half-way
 * slate is unreadable — so it flips to night's light ink once night is the larger share.
 *
 * ⚠️ OUTSIDE THE COLOUR FRAMEWORK, on purpose (the same divergence as the tower's
 * `PHASE_SKY`): the framework has no dawn, sunset or night tiers, so the phase grounds are
 * the design's own values. Day-time keys, ink and lines DO come from COLORS; each
 * substitution of a design value by its nearest token is noted beside it.
 *
 * Depends on: src/timeOfDay/dayPhase.ts, theme/colors.ts. Depended on by: useEipPalette.ts,
 * EipPaletteContext.tsx. Docs: docs/EIP_SHEET_GESTURES.md § Time of day.
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
    /** True when the ink is light — hosts swap the flashcard theme palette on this. */
    dark: boolean;
}

// ── Day-time keys, shelf and ink: shared by dawn, day and sunset ─────────────────
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

const PHASE_PALETTE: Record<DayPhase, EipPalette> = {
    // `.t2d` — rose, the tower's dawn sky (hue 351) at a faint tint.
    dawn: {
        ...LIGHT_BASE,
        ground: "#FBEEF1",
        well: "#F4DFE5",
        wellShadow: "#EAD0D8",
        ...tabTrack("#F4DFE5", "#EAD0D8"),
    },
    // `.t2a` — pale sky. Authored oklch, shipped as the clamped hex (colors.ts rule).
    day: {
        ...LIGHT_BASE,
        ground: "#E0F3FF", // oklch(95.5% 0.028 238)
        well: "#D1EAFC", // oklch(92.5% 0.036 238)
        wellShadow: "#BDDDF2", // oklch(88% 0.045 238)
        ...tabTrack("#D1EAFC", "#BDDDF2"),
    },
    // `.t2s` — peach, the sunset sky (hue 37) at a faint tint.
    sunset: {
        ...LIGHT_BASE,
        ground: "#FCF0E6",
        well: "#F6E1CF",
        wellShadow: "#EDD1BA",
        ...tabTrack("#F6E1CF", "#EDD1BA"),
    },
    // `.t2n.t2ni` — Night–inverted: everything slate, light ink.
    night: {
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
    },
};

const COLOR_KEYS = [
    "ground", "well", "wellShadow", "face", "edge", "shelf", "shelfGrab",
    "tabWell", "tabWellShadow", "tabOn", "card",
] as const;
const INK_KEYS = ["ink", "ink2", "muted", "line", "dark"] as const;

/**
 * The eip's palette at one time of day: the two phases' fills mixed `t` of the way, and
 * the ink of whichever phase the blend is mostly in (night's once night is ≥ half).
 */
export function eipPaletteAt(time: TimeOfDay): EipPalette {
    const a = PHASE_PALETTE[time.from];
    const b = PHASE_PALETTE[time.to];
    if (time.from === time.to || time.t <= 0) return a;
    const out = {} as Record<keyof EipPalette, string | boolean>;
    for (const k of COLOR_KEYS) out[k] = mixHex(a[k], b[k], time.t);
    const inkFrom = phaseShare(time, "night") >= 0.5 ? PHASE_PALETTE.night : (time.from === "night" ? b : a);
    for (const k of INK_KEYS) out[k] = inkFrom[k];
    return out as unknown as EipPalette;
}

/** The fixed day palette — for hosts with no clock (tests, the inline cdp panels). */
export const EIP_DAY_PALETTE = PHASE_PALETTE.day;

/**
 * Linear sRGB-space mix of two `#RRGGBB` colours. Plain gamma-space lerp on purpose: the
 * phase grounds are near-white tints a few % apart, where the difference from an OKLCH mix
 * is invisible, and it keeps this module free of the Deck Tower's iso colour maths.
 */
function mixHex(a: string, b: string, t: number): string {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (shift: number) => {
        const x = (pa >> shift) & 255;
        const y = (pb >> shift) & 255;
        return Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
    };
    return `#${ch(16)}${ch(8)}${ch(0)}`;
}
