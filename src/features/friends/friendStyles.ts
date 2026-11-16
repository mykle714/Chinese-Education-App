import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";

/**
 * Shared `sx` fragments for the Friends tab and its three action bodies (docs/FRIENDS_FEATURE.md).
 *
 * Kept out of the page components so each of those files exports only its
 * component — the react-refresh rule this repo lints for (mixing component and
 * constant exports breaks Fast Refresh for the whole module).
 */

// ⚠️ `navButtonSx` and `cornerBadgeSx` lived here until the shelf redesign's entry 8.
// FriendsBody's three action buttons are `BentoTile`s now (a toggle group since 2026-11-13 —
// FriendActionTiles.tsx), so the valence colouring moved onto the tiles' ramp hues (blu / grn / red) and the overhanging count badge
// became the tile's own `pin` with `pinTone="alert"` — one badge recipe for the whole
// app instead of a friends-only fragment. Do not reinstate either; if another screen
// needs a counted destination, it needs a Bento tile.

/**
 * The Send button on SentRequestsBody's "Add a friend" row.
 *
 * Fill: `bluM` — the same `RAMP.blu.mid` ground the Friends tab's Send tile wears
 * (FriendActionTiles → BentoTile), so the tile and the button it opens onto share one
 * "send" blue. v2: a button is a MID-tier fill with ink text (hue never carries text).
 *
 * Geometry is pinned to the small outlined TextField beside it: 40px tall and the same
 * 16px radius (`borderRadius: 2` = 2 × theme.shape.borderRadius there too), so the two
 * read as one row instead of a short button floating next to a taller field. The start
 * icon's MUI default margins (−4px / 8px) are replaced with a tighter 6px gap.
 * Carries the app's button outline (CLAUDE.md § "Buttons & cards").
 */
export const sendButtonSx = {
    textTransform: "none",
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    lineHeight: 1,
    color: COLORS.onSurface,
    backgroundColor: COLORS.bluM,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 2,
    flexShrink: 0,
    height: 40,
    minWidth: 0,
    px: 1.75,
    "& .MuiButton-startIcon": { marginLeft: 0, marginRight: "6px" },
    "&:hover": { backgroundColor: COLORS.bluM, filter: "brightness(0.97)" },
} as const;

/**
 * A FILLED row button — the per-row Remove (RemoveFriendsBody) and Accept
 * (IncomingRequestsBody) buttons: text only, no icon.
 *
 * Same recipe as `sendButtonSx`: v2 buttons are a MID-tier fill with INK text (hue never
 * carries text), so a "red" button is the ramp's `redM` ground, not red letters. It
 * carries the app's button outline (`COLORS.border`, CLAUDE.md § "Buttons & cards"),
 * which on a pastel this small is what keeps it reading as a shape. Compact — it sits in a
 * list row's actions slot beside a 36px avatar, so it stays caption-sized and tight.
 *
 * `radius` is explicit px on purpose: MUI reads a bare number as a multiple of
 * theme.shape.borderRadius (8), so `2` would be 16px — already a pill at this height.
 */
const filledRowButtonSx = (fill: string, radius: string) => ({
    textTransform: "none",
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.semibold,
    color: COLORS.onSurface,
    backgroundColor: fill,
    border: `1px solid ${COLORS.border}`,
    borderRadius: radius,
    minWidth: 0,
    px: 1.5,
    py: 0.5,
    "&:hover": { backgroundColor: fill, filter: "brightness(0.97)" },
} as const);

/** Remove (unfriend) — a red rounded RECTANGLE. 10px (was 6px until 2026-11-13, user) is
 *  softer but still clearly short of the pills below, so it doesn't read as a request
 *  button. */
export const removeButtonSx = filledRowButtonSx(COLORS.redM, "10px");

/** Accept (a friend request) — the same button as a green PILL. */
export const acceptButtonSx = filledRowButtonSx(COLORS.grnM, "999px");

/** Decline (a friend request) — Accept's red twin: same pill, `redM` ground. */
export const declineButtonSx = filledRowButtonSx(COLORS.redM, "999px");

/** Withdraw (your own pending request) — a GOLD pill (`gld`, the action metal). Was
 *  `bluM` until 2026-11-15, then briefly `yelM`; the user chose gold. ⚠️ `gld` breaks the
 *  ramp's lightness bands on purpose (colors.ts § `--gld`) and was the Arena's
 *  single-action colour, so this is a second, deliberate use of it. */
export const withdrawButtonSx = filledRowButtonSx(COLORS.gld, "999px");

/** A Friends section card's header — "Your friend code" (FriendsBody) and "Add a friend"
 *  (SentRequestsBody). `SIZE.subtitle` is the scale's sub-header step; the two share this
 *  so they read as the same kind of heading. */
export const sectionHeadingSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.subtitle,
    fontWeight: WEIGHT.bold,
    lineHeight: LEADING.tight,
    color: COLORS.onSurface,
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
