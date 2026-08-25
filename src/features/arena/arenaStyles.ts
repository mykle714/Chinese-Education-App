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

/** 1-based division → its display name, clamped so a bad value cannot crash the page. */
export function divisionName(division: number): string {
    const i = Math.min(Math.max(Math.round(division), 1), DIVISION_NAMES.length);
    return DIVISION_NAMES[i - 1];
}

// ⚠️ `DIVISION_COLORS`, `divisionColor` and `divisionTextColor` lived here until the
// shelf redesign's entry 9. They were a 12-step walk over the app's UI tokens, and they
// carried a standing note asking to be re-derived when Arena was converted.
//
// That re-derivation has NOT happened, and this file is no longer where it would live.
// The rung's appearance belongs to `DivisionBanner.tsx`, which currently draws every rung
// in the same neutral grey — an explicit placeholder, taken so that shipping the banner
// did not also mean taking a palette decision (the design's twelve material plates would
// have minted ~30 hexes outside the ramp). Do NOT reinstate a colour ladder here; the
// banner is the one component that decides what a rung looks like.
// Tracked in docs/DEFERRED_WORK.md.
//
// `joinButtonSx` is gone too: the MUI theme already skins `variant="contained"` as the
// design's `.btn2` ink pill, so the arena's primary actions need no bespoke sx at all.
// (Join used to be a green fill, which spent the page's PROMOTION colour on a button.)

/**
 * The quiet actions in a dialog's action bar — Clear, Cancel.
 *
 * A dialog bar is the one place the design's two button skins do not fit: `.btn2` is a
 * filled pill and `.btn3` is a full-width block, and a row of three of either reads as
 * three equally-weighted commitments. These stay bare text so the one contained Save
 * beside them is unmistakably the primary.
 */
export const dialogQuietButtonSx = {
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

// ⚠️ `sectionCardSx` also lived here — a third copy of the design's `.card`, which is now
// the `SectionCard` primitive (src/components/primitives/SectionCard.tsx).

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
