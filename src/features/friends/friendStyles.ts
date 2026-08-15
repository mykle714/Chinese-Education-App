import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * Shared `sx` fragments for the three friend screens (docs/FRIENDS_FEATURE.md).
 *
 * Kept out of the page components so each of those files exports only its
 * component — the react-refresh rule this repo lints for (mixing component and
 * constant exports breaks Fast Refresh for the whole module).
 */

/**
 * The three destination buttons across the top of FriendsPage, as a factory over the
 * fill colour.
 *
 * Colour carries the ACTION's valence, matching how the request rows already colour
 * their controls (Accept green / Decline red on IncomingRequestsPage): green for the
 * affirmative one, red for the destructive one, neutral blue for the rest. A button
 * that removes people should not look like a button that adds them.
 */
export const navButtonSx = (background: string) => ({
    flex: 1,
    textTransform: "none",
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    color: COLORS.onSurface,
    backgroundColor: background,
    borderRadius: 3,
    py: 1,
    "&:hover": { backgroundColor: background, filter: "brightness(0.97)" },
}) as const;

/** Compact inline row actions — Copy, Remove, Accept, Decline, Revoke. */
export const smallButtonSx = {
    textTransform: "none",
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.semibold,
    color: COLORS.textSecondary,
    minWidth: 0,
    px: 1,
} as const;

/** The Send button on SentRequestsPage — the one affirmative action in the feature. */
export const sendButtonSx = {
    textTransform: "none",
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    color: COLORS.onSurface,
    backgroundColor: COLORS.greenAccent,
    borderRadius: 2,
    flexShrink: 0,
    px: 1.5,
    "&:hover": { backgroundColor: COLORS.greenAccent, filter: "brightness(0.97)" },
} as const;

/** Centred loading / empty-state copy. */
export const mutedTextSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    color: COLORS.textSecondary,
    textAlign: "center",
    py: 3,
} as const;

/** Inline error line; also used (recoloured) for the success notice. */
export const messageSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    color: COLORS.redMain,
} as const;

/** A boxed section — the my-ID card and the compose card. */
export const sectionCardSx = {
    p: 1.5,
    borderRadius: 3,
    backgroundColor: COLORS.sectionCard,
    border: `1px solid ${COLORS.rowBorder}`,
} as const;
