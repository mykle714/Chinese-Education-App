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

// ⚠️ `navButtonSx` and `cornerBadgeSx` lived here until the shelf redesign's entry 8.
// FriendsPage's three action buttons are `BentoTile`s now, so the valence colouring
// moved onto the tiles' ramp hues (blu / grn / red) and the overhanging count badge
// became the tile's own `pin` with `pinTone="alert"` — one badge recipe for the whole
// app instead of a friends-only fragment. Do not reinstate either; if another screen
// needs a counted destination, it needs a Bento tile.

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

// ⚠️ `sectionCardSx` also lived here, and in `arenaStyles.ts`, and inline in a third
// place — three copies of the design's `.card`, all three of which had drifted from it
// (a 24px radius where the design says 18px, 12px of padding where it says 14/16). It is
// the `SectionCard` primitive now (src/components/primitives/SectionCard.tsx).
