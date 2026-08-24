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
    // Anchor for the corner badge, which is absolutely positioned against the
    // button's own box and deliberately overhangs it — so the button must not
    // clip its overflow (MUI's ripple container sets overflow:hidden on the root).
    position: "relative",
    overflow: "visible",
    "&:hover": { backgroundColor: background, filter: "brightness(0.97)" },
}) as const;

/**
 * The unread-count badge on a nav button (incoming requests, pending challenges).
 *
 * It sits ON TOP OF the button's top-right corner rather than inline after the
 * label: inline, the badge shifted the label off-centre and made the three
 * equal-thirds buttons read as different widths. Overhanging the corner keeps the
 * label centred and makes the count read as a notification stuck to the control
 * rather than as part of its text.
 */
export const cornerBadgeSx = {
    position: "absolute",
    top: -6,
    right: -6,
    zIndex: 1,
    minWidth: 20,
    height: 20,
    px: 0.5,
    borderRadius: "10px",
    backgroundColor: COLORS.dangerInk,
    color: "#fff",
    fontSize: SIZE.micro,
    fontWeight: WEIGHT.bold,
    fontFamily: FONTS.sans,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    // Lifts the badge off the button fill so it stays legible on any accent colour.
    border: `2px solid ${COLORS.background}`,
    pointerEvents: "none",
} as const;

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
    color: COLORS.dangerInk,
} as const;

/** A boxed section — the my-ID card and the compose card. */
export const sectionCardSx = {
    p: 1.5,
    borderRadius: 3,
    backgroundColor: COLORS.sectionCard,
    border: `1px solid ${COLORS.rowBorder}`,
} as const;
