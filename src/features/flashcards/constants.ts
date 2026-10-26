import { FONTS } from "../../theme/fonts";
import { COLORS } from "../../theme/colors";

// Swipe feedback colors (swipe right = correct, swipe left = incorrect).
//
// v2 (docs/SHELF_REDESIGN.md § A1b) splits what used to be one pair of saturated
// literals (#05C793 / #EF476F) by JOB:
//   - the WASH over the dragged card takes the MARK tier (grnMk / redMk) — the
//     fluorescent tier is the only one that still reads at the overlay's 0.3 opacity
//     cap over a cream card face; a surface pastel at 30% is indistinguishable from none;
//   - the coaching LABEL (`.shint.l` / `.shint.r`) is `var(--danger)` / `var(--success)`
//     in v2, which are both ink. DIVERGES FROM v2 ON PURPOSE (2026-10-06, user call):
//     the "← Incorrect" / "Correct →" labels take the same Mark tier as the wash, so
//     each direction's label matches the color the card turns when dragged that way.
//     The palette has no hue ink tier, so the Mark tier is the deepest red/green available.
export const CORRECT_WASH   = COLORS.grnMk;
export const INCORRECT_WASH = COLORS.redMk;
export const CORRECT_LABEL   = COLORS.grnMk;
export const INCORRECT_LABEL = COLORS.redMk;
// (The streak-flame "fire active" color moved to theme/colors.ts → COLORS.fireActive,
// since only MinutePointsFireBadge used it — it was never a flashcard color.)

// Shared font stacks for the learn page. These now alias the app-wide tokens
// (src/theme/fonts.ts) so the learn page and the rest of the app stay in sync.
// FC_FONT — Latin UI text (labels, definitions, chips).
// FC_FONT_CJK — Latin text that may need a CJK fallback glyph (English block).
export const FC_FONT = FONTS.sans;
export const FC_FONT_CJK = FONTS.cjk;

// Card fly-out animation duration. The JS dismiss timeout (FlashcardsLearnPage)
// and the CSS transform transition (FlashCardSection) MUST stay in lock-step,
// so both derive from this single constant. Changing it here changes both.
export const CARD_FLY_OUT_MS = 450;

/**
 * The flp card's proportions (width : height), the `aspect-ratio` FlashCardSection's card
 * wrapper keeps. The Deck Tower's card footprint is cut to the same shape, because its
 * study camera lands the tower's top card exactly on this card
 * (src/features/deckTower/towerPlatforms.ts → `CARD_D`; docs/DECK_TOWER.md § "Studying the tower").
 */
export const FLP_CARD_ASPECT = { width: 295, height: 426 } as const;

/**
 * The flp card's corner radius as a fraction of its WIDTH. Shared with the Deck Tower's
 * card footprint (towerPlatforms.ts → `CARD`, `r = CARD_W × this`) for the same reason as
 * `FLP_CARD_ASPECT`: the study camera lays the tower's top card exactly over this card, so
 * their corners must match at every screen size. FlashCardSection turns it into the
 * `--card-radius` it sets on the card frame (`flpCardRadiusCss`). 0.45 / 4.8 world units.
 */
export const FLP_CARD_CORNER_RATIO = 0.09375;

/**
 * The Deck Tower card's STOCK RIM as a fraction of the card's WIDTH: how far the beige
 * printed panel sits in from the card's cream edge, on every side. The tower draws it as
 * IsoCard's `FACE_PAD` (0.34 world units on a 4.8-wide card — keep the two in step); the
 * tower-hosted flp paints the same rim + panel on its faces (CardFaceSide `towerStock`,
 * FlashCardSection's `--card-stock-inset`), so the study card and the tower's own cards
 * are one card stock. Docs: docs/TOWER_STYLE_SHIFT.md § "Card stock".
 */
export const FLP_CARD_STOCK_INSET_RATIO = 0.34 / 4.8;

/**
 * The Deck Tower card's beige PANEL corner radius (the cream rim's inner radius) as a
 * fraction of the card's WIDTH. IsoCard's `PANEL_RADIUS` (0.24 world units on a 4.8-wide
 * card — keep the two in step). Rounder than concentric with the card's corner
 * (`FLP_CARD_CORNER_RATIO − FLP_CARD_STOCK_INSET_RATIO` would be a near-square 0.11 units),
 * so the rim swells a little at the corners. FlashCardSection sets it as `--card-panel-radius`.
 */
export const FLP_CARD_PANEL_RADIUS_RATIO = 0.24 / 4.8;
export const CARD_FLY_OUT_TRANSITION = `transform ${CARD_FLY_OUT_MS}ms ease`;

// The flip (Side 1 → Side 2 rotateY) is a separate, faster animation from the
// fly-out — a user flips far more often than they dismiss, so it gets its own
// duration. The JS flip-lockout timer (useCardDrag) and the mid-flip away-face
// visibility delay (FlashCardSection's CardFaceSide) MUST stay in lock-step with
// this, so both derive from this single constant. Changing it here changes both.
// (The Deck Tower flips at its own TOWER_CARD_FLIP_MS, below, passed as `flipMs`.)
export const CARD_FLIP_MS = 250;

// The 3D flip (rotateY) uses a LINEAR curve, NOT `ease`, on purpose: the away-facing
// face is hidden (visibility) at the time-midpoint to defeat the mobile
// backface-visibility bug (see CardFaceSide). With `ease`, the card reaches 90°
// (edge-on) well before the time-midpoint, so the rotated-away face's mirrored
// backside would flash between edge-on and the hide. `linear` makes 90° land exactly
// at CARD_FLIP_MS / 2, so the hide fires precisely at edge-on — no flash.
export const cardFlipTransition = (flipMs: number): string => `transform ${flipMs}ms linear`;

// The Deck Tower's flip (FlashCardSection `towerStack`) is slower: there the card is
// LIFTED off the deck as it turns (FlashCardSection → FLIP_LIFT_KEYFRAMES), and the lift
// needs the time to read. Every place that times off the flip takes the duration as a
// parameter (`flipMs`) so the tower's lockout and mid-flip face hide stay in lock-step
// with its own rotation. Docs: docs/DECK_TOWER.md § "Studying the tower".
export const TOWER_CARD_FLIP_MS = 350;

// Tab accent colors — decorative, consistent across all themes.
//
// The ramp's MARK tier, named directly. These used to alias MARK_TYPE_COLORS
// (recognition / writing / reading) as a palette economy, which meant repainting a
// SKILL repainted the eip tabs too — and on 2026-10-02 the skills were repainted
// (reading green, writing purple, recognition no hue). The tabs were never about
// skills, so they now name their own ramp members and keep the look they had.

// Controls vertical alignment of content within both card faces (front + back)
export const CARD_FACE_JUSTIFY = 'flex-start';

// Fraction of viewport width the card must be dragged before the color overlay appears
// and the mark is triggered. Single source of truth for both thresholds.
// ~15% of vw → ≈60px on the 402px phone frame.
export const CARD_DISMISS_THRESHOLD_VW = 0.15;

// Drag amplification factor. The card's translation is scaled by this multiplier
// relative to the raw finger/cursor delta, so the card moves slightly faster than
// the pointer (a value of 1 would track one-to-one). Applied uniformly to x and y
// in useCardDrag's move handlers. Note this also makes the dismiss threshold easier
// to reach, since the dismiss check reads the amplified dragPosition.
export const CARD_DRAG_SENSITIVITY = 1.6;

// Original card dimensions — source size used for scaling math.
export const CARD_BASE_WIDTH = 295;
export const CARD_BASE_HEIGHT = 426;

// Tab config — order matches: definition, examples, breakdown
// "definition" shows the long definition + HSK level + parts of speech (default tab).
// "examples" shows example sentences.
// "breakdown" shows per-character rows + the per-character rationale block.
export const TAB_COLORS = [
    COLORS.bluMk, // definition
    COLORS.orgMk, // examples
    COLORS.redMk, // breakdown
];
export const TAB_LABELS = ["definition", "examples", "breakdown"];

// Horizontal swipe-to-change-tab gesture (InfoCardPanelBody's underline tab
// strip). AXIS_LOCK_PX is the cumulative touch movement before the gesture
// commits to horizontal (tab swipe) vs vertical (sheet resize/scroll) — below
// this slop, moves are left untouched so tiny wobbles don't glitch either
// gesture. COMMIT_RATIO is the fraction of the pane's width a swipe must
// travel before release advances the tab instead of snapping back.
export const TAB_SWIPE_AXIS_LOCK_PX = 8;
export const TAB_SWIPE_COMMIT_RATIO = 0.22;
// Rubber-band at the ends of the strip. Swiping left on the LAST tab (breakdown /
// "used in") or right on the FIRST one used to clamp the track to exactly zero
// travel, which is visually identical to "this tab has no swipe" — the gesture
// looked broken rather than bounded. The track now follows the finger at
// EDGE_RUBBER_RATIO of its travel, capped at EDGE_RUBBER_MAX_PX, and springs back
// on release (settleDrag can never commit past an end, so the snap-back is
// automatic). The cap stays well under paneWidth * TAB_SWIPE_COMMIT_RATIO so an
// overscroll can never read as a committed swipe.
export const TAB_SWIPE_EDGE_RUBBER_RATIO = 0.25;
export const TAB_SWIPE_EDGE_RUBBER_MAX_PX = 40;
// Shared by both swipe-release and tap-triggered slides so the two feel identical.
export const TAB_SWIPE_TRANSITION = "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)";

// Max sheet height as a fraction of ContentArea height. The sheet at
// translateY=0 occupies this much of the container — i.e. how close the
// "maximized" panel gets to the page header above it.
export const EIC_FULL_RATIO = 0.9;

/**
 * How far the card's own top-edge chrome (CardOpsRail's `•••`, the CardNote strip) sits in
 * from the card's edge, as a custom property the flp's card frame sets — below the card's
 * top band, where the flp's hint labels sit in the corners (FlashCardSection
 * `TOWER_TOP_BAND_VARS` / `PLAIN_TOP_BAND_VARS`). Unset elsewhere (the cdp): each reader
 * falls back to its own px.
 */
export const cardChromeInsetCss = (fallbackPx: number): string => `var(--card-chrome-inset, ${fallbackPx}px)`;
