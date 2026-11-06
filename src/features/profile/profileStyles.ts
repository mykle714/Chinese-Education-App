import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * Shared `sx` fragments for the user profile page (docs/USER_PROFILE_PAGE.md).
 *
 * Kept out of the components so each of those files exports only its component —
 * the react-refresh rule this repo lints for (mixing component and constant exports
 * breaks Fast Refresh for the whole module). Same split as friendStyles.ts.
 */

/** A boxed section — the stats card, the designs header. */
export const profileCardSx = {
    p: 1.5,
    borderRadius: 3,
    backgroundColor: COLORS.sectionCard,
    border: `1px solid ${COLORS.rowBorder}`,
} as const;

/** Small muted line — "learning since", empty states, the block explainer. */
export const profileMutedSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    color: COLORS.textSecondary,
} as const;

/** Inline error line. */
export const profileErrorSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    color: COLORS.dangerInk,
} as const;

/** A section heading ("Card designs", "Progress"). */
export const profileSectionTitleSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.semibold,
    color: COLORS.onSurface,
} as const;

