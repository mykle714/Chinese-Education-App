import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * Shared `sx` fragments and labels for the arena screens
 * (docs/ARENA_FEATURE.md).
 *
 * Kept out of the page components so each of those files exports only its
 * component — the react-refresh rule this repo lints for (mixing component and
 * constant exports breaks Fast Refresh for the whole module).
 */

/**
 * The twelve rungs.
 *
 * Named rather than numbered because "Division 7" tells a learner nothing about
 * whether that is good, while a named progression does. The names are a materials
 * ladder — soft stone, then the medals, then engineered alloys, then gems — so the
 * climb reads without needing the number beside it.
 */
export const DIVISION_NAMES = [
    "Slate", "Bronze", "Silver", "Gold", "Steel", "Platinum",
    "Iridium", "Obsidian", "Titanium", "Jade", "Diamond", "Legendary",
] as const;

/**
 * One accent per rung, index-aligned with DIVISION_NAMES.
 *
 * The walk is pale-and-neutral at the bottom → warm through the medal rungs →
 * dark through the heavy-metal rungs (Iridium, Obsidian) → saturated at the top,
 * so the ladder reads as a climb using only existing tokens (no new palette).
 */
// ⚠️ PARTIALLY RE-DERIVED for the shelf redesign (docs/SHELF_REDESIGN.md, D2).
// Rungs 10-12 used to be `greenMain / blueMain / purpleAccent`. Those tokens are
// PASTELS now, which inverted the whole point of the walk — the ladder ended paler
// than it started. They are re-pointed at the ramp's saturated members so the climb
// still terminates dark. The lower rungs are untouched.
//
// This is a minimal repair, not a considered pass: the sequence still dips pale at
// rungs 5-6 after a warm rung 4, which reads oddly. Re-derive the whole 12-step walk
// against the new ramp when Arena is converted (entry 9).
export const DIVISION_COLORS = [
    COLORS.card, COLORS.cardBeige, COLORS.header, COLORS.yellowMain,
    COLORS.rowHoverBg, COLORS.iconBg, COLORS.textSecondary, COLORS.iconColor,
    COLORS.blueAccent, COLORS.successInk, COLORS.infoInk, COLORS.purA,
] as const;

/** 1-based division → its display name, clamped so a bad value cannot crash the page. */
export function divisionName(division: number): string {
    const i = Math.min(Math.max(Math.round(division), 1), DIVISION_NAMES.length);
    return DIVISION_NAMES[i - 1];
}

/** 1-based division → its accent colour. */
export function divisionColor(division: number): string {
    const i = Math.min(Math.max(Math.round(division), 1), DIVISION_COLORS.length);
    return DIVISION_COLORS[i - 1];
}

/**
 * Rungs whose accent is dark enough that the default dark body text on top of it
 * fails to read — Iridium and Obsidian. Listed explicitly (1-based) rather than
 * computed from luminance so the set is auditable when the palette is retuned.
 */
const DARK_DIVISIONS = new Set<number>([7, 8]);

/** 1-based division → the text colour to use ON its accent. */
export function divisionTextColor(division: number): string {
    const i = Math.min(Math.max(Math.round(division), 1), DIVISION_COLORS.length);
    return DARK_DIVISIONS.has(i) ? COLORS.background : COLORS.onSurface;
}

/** The primary call to action — Join. */
export const joinButtonSx = {
    textTransform: "none",
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    color: COLORS.onSurface,
    backgroundColor: COLORS.greenAccent,
    borderRadius: 3,
    py: 1,
    px: 3,
    "&:hover": { backgroundColor: COLORS.greenAccent, filter: "brightness(0.97)" },
} as const;

/** Secondary / withdraw. */
export const secondaryButtonSx = {
    textTransform: "none",
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.semibold,
    color: COLORS.textSecondary,
    minWidth: 0,
    px: 1,
} as const;

/** Centred loading / empty-state copy. */
export const mutedTextSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    color: COLORS.textSecondary,
    textAlign: "center",
    py: 3,
} as const;

/** A boxed section — the countdown card, the opt-in card, the results banner. */
export const sectionCardSx = {
    p: 1.5,
    borderRadius: 3,
    backgroundColor: COLORS.sectionCard,
    border: `1px solid ${COLORS.rowBorder}`,
} as const;

/** Inline error line. */
export const errorTextSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    color: COLORS.dangerInk,
} as const;

/**
 * Human-readable time remaining, e.g. "2d 4h" or "38m".
 *
 * Deliberately coarse above an hour: a live-ticking second counter on a
 * five-day race invites people to watch the clock instead of study, and it
 * forces a re-render every second for no informational gain.
 */
export function formatRemaining(msRemaining: number): string {
    if (msRemaining <= 0) return "closed";
    const totalMinutes = Math.floor(msRemaining / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
