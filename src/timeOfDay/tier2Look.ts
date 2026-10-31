import { COLORS } from "../theme/colors";
import { phaseShare, type DayPhase, type TimeOfDay } from "./dayPhase";

/**
 * tier2Look.ts — what a "Tier 2" page (a page one level under the Deck Tower, with no sky
 * of its own) looks like at the learner's time of day. Source: Claude Design project
 * "Tower Tier 2 - Time of Day", the Dictionary artboards per phase (`.t2d` / `.t2a` /
 * `.t2s` / `.t2n` and the `.t2n .phone` overrides).
 *
 * Layer: shared module (`src/timeOfDay/`). Pure; no React. `useTier2Look` samples the clock
 * and turns it into a look; `tier2Chrome.ts` hands the parts drawn OUTSIDE the page (the
 * slab footer, the beginner keyboard) to them through root CSS custom properties.
 *
 * ── What a phase changes ──────────────────────────────────────────────────────
 *   DAWN / DAY / SUNSET change only the GROUND and its sunken WELL — a pale tint of the
 *   tower's sky at that hour (the design's `--g`, `--well`, `--wellSh`). Surfaces (the
 *   search field, result slabs, keycaps), the slab footer and the ink stay as by day.
 *   NIGHT turns the whole page slate (owner's choice 2026-10-29, following the design's
 *   CSS over its "keep day colours" note): a #1E2735 ground, #2A3446 surfaces on a
 *   #121822 lip, light ink — the footer and the keyboard keys included.
 *
 * ── Blending ──────────────────────────────────────────────────────────────────
 * The ground and well BLEND across the tower's 30-minute twilights, so this page and the
 * tower always agree on the hour. Surfaces and ink cannot blend — half-way white on
 * half-way slate under half-way ink is unreadable — so they FLIP together once night is
 * the larger share (`dark`), the same rule as the eip's ink (eipPalette.ts).
 *
 * The ground values are the eip's upper-panel `--g` family (eipPalette.ts carries the same
 * hexes for its own panel); the Sort Cards page uses the design's separate `--gr` ground by day and
 * the tower's night sky at night (features/discover/sortTimeOfDay.ts). Keep them apart.
 *
 * ⚠️ OUTSIDE THE COLOUR FRAMEWORK, on purpose (like the tower's `PHASE_SKY`): the
 * framework has no dawn, sunset or night tiers, so the phase grounds and every night
 * value are the design's own hexes. Day surfaces and ink DO come from COLORS.
 *
 * Depends on: dayPhase.ts, theme/colors.ts. Depended on by: useTier2Look.ts,
 * tier2Chrome.ts. Docs: docs/SHELF_REDESIGN.md § 7b "Time of day".
 */

export interface Tier2Look {
    /** The page ground (MobileTabScreen surfaceColor), and the keyboard's surface. */
    ground: string;
    /** A sunken well cut into the ground (the no-results panel, the keyboard switch track). */
    well: string;
    /** The well's inner top lip. */
    wellShadow: string;
    /** Raised surfaces on the ground: the search field, result slabs, keycaps. */
    surface: string;
    /** A keycap's solid drop lip. */
    surfaceEdge: string;
    /** The 1px outline every surface carries (CLAUDE.md § Buttons & cards). */
    outline: string;
    /** Hairlines between rows on a slab. */
    line: string;
    /** A row's pressed tint. */
    pressed: string;
    /** Text and icons: primary, secondary (icons, glosses), muted (overlines, chevrons). */
    ink: string;
    ink2: string;
    muted: string;
    /** The slab footer: its face, its lip, the active tab's well, idle and active labels. */
    footerFace: string;
    footerWall: string;
    footerKey: string;
    footerInk: string;
    footerInkActive: string;
    /** True once night holds the larger share — surfaces and ink are the slate set. */
    dark: boolean;
}

type Ground = Pick<Tier2Look, "ground" | "well" | "wellShadow">;
type Surfaces = Omit<Tier2Look, keyof Ground | "dark">;

// The phase grounds: the design's `--g` / `--well` / `--wellSh`. Day's are oklch in the
// design (`oklch(.955 .028 238)` …), converted to the hexes the blend works in.
const PHASE_GROUND: Record<DayPhase, Ground> = {
    dawn: { ground: "#FBEEF1", well: "#F4DFE5", wellShadow: "#EAD0D8" },
    day: { ground: "#E0F3FF", well: "#D1EAFC", wellShadow: "#BDDDF2" },
    sunset: { ground: "#FCF0E6", well: "#F6E1CF", wellShadow: "#EDD1BA" },
    night: { ground: "#1E2735", well: "#18202C", wellShadow: "#111720" },
};

/** Dawn, day and sunset: the app's day surfaces and ink, and the cream slab footer. */
const LIGHT_SURFACES: Surfaces = {
    surface: COLORS.white,
    // Design `--edge` #E2E2E6 → COLORS.grey #E7E7EA (nearest token).
    surfaceEdge: COLORS.grey,
    outline: COLORS.border,
    line: COLORS.rowBorder,
    pressed: COLORS.rowHoverBg,
    ink: COLORS.onSurface,
    ink2: COLORS.iconColor,
    muted: COLORS.textSecondary,
    // The slab footer as the Deck Tower draws it (MobileFooter → SlabFooterFace).
    footerFace: COLORS.cardFace,
    footerWall: COLORS.cardWall,
    footerKey: COLORS.cardBeige,
    footerInk: COLORS.textSecondary,
    footerInkActive: COLORS.onSurface,
};

/** Night: the design's slate set (`.t2n .phone` and the `.t2n … :is(.kc,.ft,.slab,…)` rules). */
const DARK_SURFACES: Surfaces = {
    surface: "#2A3446",
    surfaceEdge: "#121822",
    outline: "rgba(255, 255, 255, 0.12)", // design `--olc`
    line: "rgba(255, 255, 255, 0.10)", // design `--line`
    pressed: "rgba(255, 255, 255, 0.06)",
    ink: "#EEF0F6",
    ink2: "#C3C8D6",
    muted: "#8F97AA",
    footerFace: "#2A3446",
    footerWall: "#121822",
    footerKey: "#1E2735",
    footerInk: "#A3AABB", // design `.t2n … .ft div`
    footerInkActive: "#EEF0F6",
};

/** The look at `time`: grounds blended `t` of the way, surfaces and ink flipped at night's majority. */
export function tier2LookAt(time: TimeOfDay): Tier2Look {
    const from = PHASE_GROUND[time.from];
    const to = PHASE_GROUND[time.to];
    const ground: Ground = {
        ground: mixHex(from.ground, to.ground, time.t),
        well: mixHex(from.well, to.well, time.t),
        wellShadow: mixHex(from.wellShadow, to.wellShadow, time.t),
    };
    const dark = phaseShare(time, "night") > 0.5;
    return { ...ground, ...(dark ? DARK_SURFACES : LIGHT_SURFACES), dark };
}

/**
 * Blends hex `a` toward hex `b` by `t` (0 = a, 1 = b), per sRGB channel. Plain mixing is
 * fine here: neighbouring phase grounds are all pale tints, and night's blend runs
 * through the twilight the tower's sky is also crossing.
 *
 * ⚠️ DUPLICATE of features/deckTower/iso/palette.ts → `mixHex` (and a private copy in
 * eipPalette.ts). Kept local because a shared module must not import from a feature; the
 * three should collapse into one shared colour util (flagged 2026-10-29).
 */
function mixHex(a: string, b: string, t: number): string {
    if (t <= 0 || a === b) return a;
    const na = parseInt(a.slice(1), 16);
    const nb = parseInt(b.slice(1), 16);
    const u = Math.min(1, t);
    const ch = (shift: number) => {
        const ca = (na >> shift) & 255;
        const cb = (nb >> shift) & 255;
        return Math.round(ca + (cb - ca) * u).toString(16).padStart(2, "0");
    };
    return `#${ch(16)}${ch(8)}${ch(0)}`;
}
