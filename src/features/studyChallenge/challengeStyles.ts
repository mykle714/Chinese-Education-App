import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * Shared `sx` fragments for the Study Challenge screens
 * (docs/STUDY_CHALLENGE.md).
 *
 * Kept out of the page components so each of those files exports only its
 * component — the react-refresh rule this repo lints for (mixing component and
 * constant exports breaks Fast Refresh for the whole module). Same split
 * `friendStyles.ts` uses.
 */

/** A rounded surface card — the container every section on these pages sits in. */
export const challengeCardSx = {
    backgroundColor: COLORS.surface,
    borderRadius: 3,
    p: 1.5,
} as const;

/**
 * The lifecycle control on a friend row — one button whose LABEL carries the state
 * (Challenge / Review words / Play test / See results / Waiting on them).
 *
 * A factory over the fill colour because the colour carries the action's valence,
 * the way the friend screens already do: green when the ball is in the viewer's
 * court, neutral blue when it is not.
 */
export const challengeActionSx = (background: string) => ({
    textTransform: "none",
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.semibold,
    color: COLORS.onSurface,
    backgroundColor: background,
    borderRadius: 2,
    px: 1.5,
    py: 0.5,
    whiteSpace: "nowrap",
    "&:hover": { backgroundColor: background, filter: "brightness(0.97)" },
    "&.Mui-disabled": { color: COLORS.textSecondary, backgroundColor: COLORS.iconBg },
}) as const;

/** Secondary text — deadlines, "waiting on them", empty states. */
export const challengeMutedSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    color: COLORS.textSecondary,
} as const;

/** Error / notice line. */
export const challengeMessageSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    color: COLORS.redMain,
} as const;

/** A word tile in the review flow — the ten words, each strikeable. */
export const wordTileSx = {
    display: "flex",
    alignItems: "center",
    gap: 1,
    backgroundColor: COLORS.background,
    borderRadius: 2,
    px: 1,
    py: 0.75,
} as const;

/** One line of a score breakdown: label left, count centre, points right. */
export const breakdownRowSx = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 1,
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    color: COLORS.onSurface,
} as const;

/** The crown that marks the pair's reigning champion. */
export const crownSx = {
    fontSize: SIZE.body,
    lineHeight: 1,
} as const;
