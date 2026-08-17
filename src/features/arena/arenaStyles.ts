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
 * whether that is good, while a named progression does. The colours walk the app's
 * existing pastel accents from cool to warm so the ladder reads as a climb
 * without introducing a new palette.
 */
export const DIVISION_NAMES = [
    "Clay", "Slate", "Copper", "Bronze", "Iron", "Silver",
    "Gold", "Jade", "Amber", "Ruby", "Obsidian", "Celestial",
] as const;

export const DIVISION_COLORS = [
    COLORS.card, COLORS.iconBg, COLORS.cardBeige, COLORS.yellowAccent,
    COLORS.rowHoverBg, COLORS.blueAccent, COLORS.yellowMain, COLORS.greenAccent,
    COLORS.yellowMain, COLORS.redAccent, COLORS.textSecondary, COLORS.purpleAccent,
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
 * The tint behind a board row, by promotion zone.
 *
 * Only the two EDGES are tinted. Tinting every row would make the tint carry no
 * information, and the middle of the table is exactly the place where a learner
 * needs to read "nothing happens to me this week".
 */
export const zoneRowSx = (zone: "promote" | "hold" | "relegate", isViewer: boolean) => ({
    display: "flex",
    alignItems: "center",
    gap: 1.25,
    px: 1.25,
    py: 1,
    borderRadius: 2,
    // The viewer's own row is outlined rather than filled, so it stays legible on
    // top of whichever zone tint it happens to sit in.
    border: isViewer ? `2px solid ${COLORS.onSurface}` : `1px solid ${COLORS.rowBorder}`,
    backgroundColor:
        zone === "promote" ? COLORS.greenAccent
            : zone === "relegate" ? COLORS.redAccent
                : COLORS.background,
}) as const;

/** The rank chip at the left of every row. */
export const rankChipSx = {
    flexShrink: 0,
    minWidth: 28,
    height: 28,
    px: 0.5,
    borderRadius: "14px",
    backgroundColor: COLORS.iconBg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.bold,
    color: COLORS.onSurface,
} as const;

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
    color: COLORS.redMain,
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
