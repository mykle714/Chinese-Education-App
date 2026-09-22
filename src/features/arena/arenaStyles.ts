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
 * The countdown, split into `{value, unit}` parts for the big mono readout
 * (`Arena Flow - Shelf System.html` `.cdcard .big` / `.opens .big`, and `ArenaCountdown`).
 *
 * ⚠️ IT COUNTS SECONDS, which reverses an earlier decision. `formatRemaining` used to
 * stop at minutes and re-render once a minute, on the argument that a live second
 * counter on a five-day race invites people to watch the clock instead of study. The
 * arena flow draws "2d 4h 31m 8s" in every live artboard, and the product owner chose
 * the design over that argument (2026-09-21). Keep the seconds unless that is revisited;
 * `ArenaCountdown` is the only ticker, so the cost is one re-render per second on one
 * mounted page.
 *
 * Leading zero units are DROPPED, trailing ones are not: "19h 40m 12s" rather than
 * "0d 19h 40m 12s", but "3m 0s" rather than "3m". The largest unit is what makes the
 * number scannable; the smallest is what makes it feel live.
 */
export interface CountdownPart {
    value: number;
    /** Single-letter suffix — `d`, `h`, `m`, `s`. Set smaller and muted beside the value. */
    unit: "d" | "h" | "m" | "s";
}

export function formatCountdownParts(msRemaining: number): CountdownPart[] {
    // Never render a negative clock: a countdown that has run out is "0s", and the
    // caller decides whether that state is still worth showing at all.
    const total = Math.max(0, Math.floor(msRemaining / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    const all: CountdownPart[] = [
        { value: days, unit: "d" },
        { value: hours, unit: "h" },
        { value: minutes, unit: "m" },
        { value: seconds, unit: "s" },
    ];
    // Drop leading units that are zero, but never drop everything — at under a minute
    // the list must still yield "Ns" rather than an empty row.
    const firstSignificant = all.findIndex((p) => p.value > 0);
    return firstSignificant === -1 ? [{ value: 0, unit: "s" }] : all.slice(firstSignificant);
}
