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
    backgroundColor: COLORS.sectionCard,
    borderRadius: 3,
    p: 1.5,
} as const;

/**
 * The lifecycle pill on a friend row — its LABEL carries the state
 * (Challenge / Review words / Play test / See results / Waiting on them).
 *
 * A factory over the fill colour because the colour carries the action's valence,
 * the way the friend screens already do: green when the ball is in the viewer's
 * court, neutral blue when it is not.
 */
const actionPillBase = (background: string) => ({
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.semibold,
    color: COLORS.onSurface,
    backgroundColor: background,
    borderRadius: 2,
    px: 1.5,
    py: 0.5,
    whiteSpace: "nowrap",
}) as const;

/**
 * ⚠️ NOT A BUTTON ON THE CHALLENGES PAGE. The whole row is the button there
 * (docs/STUDY_CHALLENGE.md § 1), so the pill is a plain `Box` that only LOOKS like a
 * control — a real `<button>` inside a clickable row is a nested interactive element:
 * it steals the tap near its edges, adds a second tab stop for the same action, and
 * invites the two to drift apart. Everything about it is presentational; the row owns
 * the handler, the focus ring and the disabled state.
 */
export const challengeActionPillSx = (background: string) => ({
    ...actionPillBase(background),
    display: "inline-flex",
    alignItems: "center",
    // Pointer events go to the ROW, not here — otherwise a tap that lands on the pill
    // would miss the row's handler at its rounded corners.
    pointerEvents: "none",
}) as const;

/** The same pill, greyed: a row whose action is unavailable (blocked, or at the cap). */
export const challengeActionPillMutedSx = {
    ...actionPillBase(COLORS.iconBg),
    display: "inline-flex",
    alignItems: "center",
    color: COLORS.textSecondary,
    pointerEvents: "none",
} as const;

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
    color: COLORS.dangerInk,
} as const;

// ── Challenge word card geometry (ChallengeWordCard) ─────────────────────────────
// Lives here rather than in the component so MiniVocabCardGrid's callers can reserve
// the row height without importing the card (and so the card file exports only a
// component, which is what react-refresh wants).
//
// The 92×132 thumbnail is the app-wide mini preview footprint — MiniVocabCard and
// QuickMarkCard use the identical box, which is why all three drop into the same grid.
export const CHALLENGE_WORD_CARD_WIDTH = 92;
export const CHALLENGE_WORD_THUMBNAIL_HEIGHT = 132;
/** The strike button block below the thumbnail; absent on the read-only card. */
export const CHALLENGE_WORD_BUTTON_HEIGHT = 32;

/** Row height to reserve in MiniVocabCardGrid, with or without the strike button. */
export const challengeWordCardHeight = (strikeable: boolean): number =>
    CHALLENGE_WORD_THUMBNAIL_HEIGHT + (strikeable ? CHALLENGE_WORD_BUTTON_HEIGHT : 0);

// (`wordTileSx` — the old full-width review/detail word row — was removed when both
// surfaces moved to the mini preview card grid.)

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
